import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockGetConfig = vi.fn<(key: string) => unknown>();
const mockStartTransaction = vi.fn();
const mockCaptureError = vi.fn();
const mockGenerateText = vi.fn<(options: unknown) => Promise<unknown>>();

const mockOpenAIModelFactory = vi.fn<(model: string) => unknown>();
const mockAnthropicModelFactory = vi.fn<(model: string) => unknown>();
const mockGoogleModelFactory = vi.fn<(model: string) => unknown>();

const mockCreateOpenAI = vi.fn<
  (options: { apiKey: string }) => typeof mockOpenAIModelFactory
>(() => mockOpenAIModelFactory);
const mockCreateAnthropic = vi.fn<
  (options: { apiKey: string }) => typeof mockAnthropicModelFactory
>(() => mockAnthropicModelFactory);
const mockCreateGoogleGenerativeAI = vi.fn<
  (options: { apiKey: string }) => typeof mockGoogleModelFactory
>(() => mockGoogleModelFactory);

vi.doMock('modelence/server', () => ({
  getConfig: mockGetConfig,
}));

vi.doMock('modelence/telemetry', () => ({
  startTransaction: mockStartTransaction,
  captureError: mockCaptureError,
}));

vi.doMock('ai', () => ({
  generateText: mockGenerateText,
}));

vi.doMock('@ai-sdk/openai', () => ({
  createOpenAI: mockCreateOpenAI,
}));

vi.doMock('@ai-sdk/anthropic', () => ({
  createAnthropic: mockCreateAnthropic,
}));

vi.doMock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: mockCreateGoogleGenerativeAI,
}));

const { generateText } = await import('./index');

describe('@modelence/ai generateText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        '_system.openai.apiKey': 'openai-key',
        '_system.anthropic.apiKey': 'anthropic-key',
        '_system.gemini.apiKey': 'google-key',
      };
      return values[key];
    });
  });

  test('uses OpenAI provider, forwards options, and ends transaction with usage context', async () => {
    const transaction = {
      end: vi.fn(),
      setContext: vi.fn(),
    };
    mockStartTransaction.mockReturnValue(transaction);

    const modelInstance = { provider: 'openai', model: 'gpt-4o' };
    mockOpenAIModelFactory.mockReturnValue(modelInstance);

    const result = {
      text: 'hello',
      usage: {
        promptTokens: 11,
        completionTokens: 7,
        totalTokens: 18,
      },
    };
    mockGenerateText.mockResolvedValue(result as never);

    const options = {
      provider: 'openai',
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Say hello' }],
      temperature: 0.4,
    };

    const response = await generateText(options as never);

    expect(mockStartTransaction).toHaveBeenCalledWith('ai', 'ai:generateText', {
      provider: 'openai',
      model: 'gpt-4o',
      messageCount: 1,
      temperature: 0.4,
    });
    expect(mockGetConfig).toHaveBeenCalledWith('_system.openai.apiKey');
    expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: 'openai-key' });
    expect(mockOpenAIModelFactory).toHaveBeenCalledWith('gpt-4o');
    expect(mockGenerateText).toHaveBeenCalledWith({
      model: modelInstance,
      messages: [{ role: 'user', content: 'Say hello' }],
      temperature: 0.4,
    });
    expect(transaction.end).toHaveBeenCalledWith('success', {
      context: {
        usage: {
          promptTokens: 11,
          completionTokens: 7,
          totalTokens: 18,
        },
      },
    });
    expect(mockCaptureError).not.toHaveBeenCalled();
    expect(response).toBe(result);
  });

  test('supports older transaction API without setContext', async () => {
    const transaction = {
      end: vi.fn(),
    };
    mockStartTransaction.mockReturnValue(transaction);

    const modelInstance = { provider: 'anthropic', model: 'claude-3-haiku' };
    mockAnthropicModelFactory.mockReturnValue(modelInstance);

    mockGenerateText.mockResolvedValue({
      text: 'ok',
      usage: {
        promptTokens: 3,
        completionTokens: 2,
        totalTokens: 5,
      },
    } as never);

    await generateText({
      provider: 'anthropic',
      model: 'claude-3-haiku',
      prompt: 'Hello',
    } as never);

    expect(mockGetConfig).toHaveBeenCalledWith('_system.anthropic.apiKey');
    expect(mockCreateAnthropic).toHaveBeenCalledWith({ apiKey: 'anthropic-key' });
    expect(mockAnthropicModelFactory).toHaveBeenCalledWith('claude-3-haiku');
    expect(transaction.end).toHaveBeenCalledWith('success');
    expect(transaction.end).toHaveBeenCalledTimes(1);
  });

  test('captures and rethrows provider/model errors', async () => {
    const transaction = {
      end: vi.fn(),
      setContext: vi.fn(),
    };
    mockStartTransaction.mockReturnValue(transaction);

    const modelInstance = { provider: 'google', model: 'gemini-1.5-pro' };
    mockGoogleModelFactory.mockReturnValue(modelInstance);

    const error = new Error('generation failed');
    mockGenerateText.mockRejectedValue(error);

    await expect(
      generateText({
        provider: 'google',
        model: 'gemini-1.5-pro',
        prompt: 'Hello',
      } as never)
    ).rejects.toThrow('generation failed');

    expect(mockGetConfig).toHaveBeenCalledWith('_system.gemini.apiKey');
    expect(mockCreateGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'google-key' });
    expect(mockGoogleModelFactory).toHaveBeenCalledWith('gemini-1.5-pro');
    expect(mockCaptureError).toHaveBeenCalledWith(error);
    expect(transaction.end).toHaveBeenCalledWith('error');
  });

  test('captures unsupported provider failures and does not call AI SDK', async () => {
    const transaction = {
      end: vi.fn(),
      setContext: vi.fn(),
    };
    mockStartTransaction.mockReturnValue(transaction);

    await expect(
      generateText({
        provider: 'invalid',
        model: 'some-model',
        prompt: 'Hello',
      } as never)
    ).rejects.toThrow('Unsupported provider: invalid');

    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(mockCaptureError).toHaveBeenCalledWith(expect.any(Error));
    expect(transaction.end).toHaveBeenCalledWith('error');
  });
});
