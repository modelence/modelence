import { isServer, requireServer, htmlToText } from './index';

describe('utils/index', () => {
  describe('isServer', () => {
    test('should return true when window is not an object', () => {
      const result = isServer();
      expect(result).toBe(true);
    });

    test('should return false when window is an object', () => {
      const originalWindow = global.window;
      (global as any).window = {};

      const result = isServer();
      expect(result).toBe(false);

      // Cleanup
      if (originalWindow === undefined) {
        delete (global as any).window;
      } else {
        global.window = originalWindow;
      }
    });
  });

  describe('requireServer', () => {
    test('should not throw error when running on server', () => {
      expect(() => requireServer()).not.toThrow();
    });

    test('should throw error when running on client', () => {
      const originalWindow = global.window;
      (global as any).window = {};

      expect(() => requireServer()).toThrow('This function can only be called on the server');

      // Cleanup
      if (originalWindow === undefined) {
        delete (global as any).window;
      } else {
        global.window = originalWindow;
      }
    });
  });

  describe('htmlToText', () => {
    test('should remove HTML tags', () => {
      expect(htmlToText('<p>Hello World</p>')).toBe('Hello World');
      expect(htmlToText('<div><span>Test</span></div>')).toBe('Test');
      expect(htmlToText('<a href="#">Link</a>')).toBe('Link');
    });

    test('should collapse multiple spaces', () => {
      expect(htmlToText('Hello    World')).toBe('Hello World');
      expect(htmlToText('Test\n\nMultiple\n\nLines')).toBe('Test Multiple Lines');
      expect(htmlToText('  Spaces   everywhere  ')).toBe('Spaces everywhere');
    });

    test('should trim whitespace', () => {
      expect(htmlToText('  Hello World  ')).toBe('Hello World');
      expect(htmlToText('\n\nTest\n\n')).toBe('Test');
    });

    test('should handle complex HTML', () => {
      const html = `
        <div>
          <h1>Title</h1>
          <p>First paragraph with <strong>bold</strong> text.</p>
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
        </div>
      `;
      const result = htmlToText(html);
      expect(result).toBe('Title First paragraph with bold text. Item 1 Item 2');
    });

    test('should handle empty string', () => {
      expect(htmlToText('')).toBe('');
    });

    test('should handle plain text without HTML', () => {
      expect(htmlToText('Just plain text')).toBe('Just plain text');
    });

    test('should handle self-closing tags', () => {
      expect(htmlToText('Line 1<br/>Line 2')).toBe('Line 1Line 2');
      expect(htmlToText('Image: <img src="test.jpg" />')).toBe('Image:');
    });
  });
});
