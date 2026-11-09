import net from 'node:net';
import { afterEach, describe, expect, test, vi } from 'vitest';

let configs: Record<string, unknown> = {};

vi.mock('modelence/server', () => ({
  getConfig: (key: string) => configs[key],
}));

const payload = {
  from: 'noreply@example.com',
  to: 'user@example.com',
  subject: 'Verify your email address',
  text: 'hello',
};

function setSmtpConfig(host: string, port: number) {
  configs = {
    '_system.email.smtp.host': host,
    '_system.email.smtp.port': String(port),
    '_system.email.smtp.user': 'user',
    '_system.email.smtp.pass': 'pass',
  };
}

/**
 * Minimal plaintext SMTP server that does not offer STARTTLS, like a
 * misconfigured server or a connection where a MITM stripped the capability.
 * Records every command it receives.
 */
function startPlaintextSmtpServer() {
  const commands: string[] = [];
  const server = net.createServer((socket) => {
    socket.write('220 localhost ESMTP test\r\n');
    socket.on('data', (chunk) => {
      for (const line of chunk.toString('utf8').split('\r\n').filter(Boolean)) {
        const command = line.split(' ')[0].toUpperCase();
        commands.push(command);
        if (command === 'EHLO' || command === 'HELO') {
          socket.write('250-localhost\r\n250 AUTH PLAIN LOGIN\r\n');
        } else if (command === 'STARTTLS') {
          socket.write('502 Command not implemented\r\n');
        } else if (command === 'AUTH') {
          socket.write('235 Authentication successful\r\n');
        } else if (command === 'QUIT') {
          socket.end('221 Bye\r\n');
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
    socket.on('error', () => {});
  });

  return new Promise<{ port: number; commands: string[]; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({ port, commands, close: () => server.close() });
    });
  });
}

async function mockCreateTransport() {
  const nodemailer = (await import('nodemailer')).default;
  return vi
    .spyOn(nodemailer, 'createTransport')
    .mockReturnValue({ sendMail: vi.fn() } as never);
}

describe('@modelence/smtp', () => {
  afterEach(() => {
    configs = {};
    vi.resetModules();
    vi.restoreAllMocks();
  });

  test('uses implicit TLS on port 465', async () => {
    const createTransport = await mockCreateTransport();
    setSmtpConfig('smtp.example.com', 465);

    const { sendEmail } = await import('./index');
    await sendEmail(payload);

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true, requireTLS: false })
    );
  });

  test.each([587, 25, 2525])('requires STARTTLS on port %i', async (port) => {
    const createTransport = await mockCreateTransport();
    setSmtpConfig('smtp.example.com', port);

    const { sendEmail } = await import('./index');
    await sendEmail(payload);

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port, secure: false, requireTLS: true })
    );
  });

  test('never sends credentials when the server does not offer STARTTLS', async () => {
    const smtp = await startPlaintextSmtpServer();
    setSmtpConfig('127.0.0.1', smtp.port);

    try {
      const { sendEmail } = await import('./index');
      await expect(sendEmail(payload)).rejects.toThrow();

      expect(smtp.commands).toContain('EHLO');
      expect(smtp.commands).not.toContain('AUTH');
      expect(smtp.commands).not.toContain('DATA');
    } finally {
      smtp.close();
    }
  }, 15000);
});
