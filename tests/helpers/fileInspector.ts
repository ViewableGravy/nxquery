import { expect } from 'bun:test'

const normalize = (value: string) => value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd() + '\n'

export class FileInspector {
  constructor(private readonly read: (relPath: string) => Promise<string>) {}

  async contents(relPath: string) {
    return this.read(relPath)
  }

  async expectContains(relPath: string, snippet: string) {
    const source = await this.contents(relPath)
    expect(source).toContain(snippet)
  }

  async expectMatches(relPath: string, matcher: RegExp) {
    const source = await this.contents(relPath)
    expect(source).toMatch(matcher)
  }

  async expectExact(relPath: string, expected: string) {
    const source = await this.contents(relPath)
    expect(normalize(source)).toBe(normalize(expected))
  }
}
