import net from 'node:net';
import { afterEach, describe, expect, test, vi } from 'vitest';

const configs: Record<string, unknown> = {};

vi.mock('modelence/server', () => ({
  getConfig: (key: string) => configs[key],
}));

/**
 * Minimal plaintext SMTP server, like a submission endpoint on port 587 before
 * STARTTLS. Resolves each received message body.
 */
function startSmtpServer() {
  const messages: string[] = [];
  const server = net.createServer((socket) => {
    let inData = false;
    let data = '';
    socket.write('220 localhost ESMTP test\r\n');
    socket.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (inData) {
        data += text;
        if (data.endsWith('\r\n.\r\n')) {
          inData = false;
          messages.push(data);
          data = '';
          socket.write('250 OK queued\r\n');
        }
        return;
      }
      for (const line of text.split('\r\n').filter(Boolean)) {
        const command = line.slice(0, 4).toUpperCase();
        if (command === 'EHLO' || command === 'HELO') {
          socket.write('250-localhost\r\n250 AUTH PLAIN LOGIN\r\n');
        } else if (command === 'AUTH') {
          socket.write('235 Authentication successful\r\n');
        } else if (command === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (command === 'QUIT') {
          socket.end('221 Bye\r\n');
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
    socket.on('error', () => {});
  });

  return new Promise<{ port: number; messages: string[]; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({ port, messages, close: () => server.close() });
    });
  });
}

describe('@modelence/smtp', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  test('delivers through a server that is not on the implicit-TLS port 465', async () => {
    const smtp = await startSmtpServer();
    Object.assign(configs, {
      '_system.email.smtp.host': '127.0.0.1',
      '_system.email.smtp.port': String(smtp.port),
      '_system.email.smtp.user': 'user',
      '_system.email.smtp.pass': 'pass',
    });

    try {
      const { sendEmail } = await import('./index');
      await sendEmail({
        from: 'noreply@example.com',
        to: 'user@example.com',
        subject: 'Verify your email address',
        text: 'hello',
      });

      expect(smtp.messages).toHaveLength(1);
      expect(smtp.messages[0]).toContain('Subject: Verify your email address');
    } finally {
      smtp.close();
    }
  }, 15000);

  test('keeps implicit TLS on port 465', async () => {
    const nodemailer = (await import('nodemailer')).default;
    const createTransport = vi
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail: vi.fn() } as never);
    Object.assign(configs, {
      '_system.email.smtp.host': 'smtp.example.com',
      '_system.email.smtp.port': '465',
    });

    const { sendEmail } = await import('./index');
    await sendEmail({ from: 'a@example.com', to: 'b@example.com', subject: 's', text: 't' });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true })
    );
  });
});
