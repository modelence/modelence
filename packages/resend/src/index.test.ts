import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('modelence/server', () => ({
  getConfig: (key: string) => (key === '_system.email.resend.apiKey' ? 're_test_key' : undefined),
}));

describe('@modelence/resend', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('sends attachment file names and content types to Resend', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'email-id' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { sendEmail } = await import('./index');
    await sendEmail({
      from: 'billing@example.com',
      to: 'user@example.com',
      subject: 'Your invoice',
      text: 'Invoice attached',
      attachments: [
        {
          filename: 'invoice.pdf',
          content: Buffer.from('%PDF-1.4'),
          contentType: 'application/pdf',
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/emails');
    const body = JSON.parse(init.body as string);
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]).toMatchObject({
      filename: 'invoice.pdf',
      content_type: 'application/pdf',
    });
  });
});
