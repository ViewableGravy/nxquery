import { FileInspector } from './fileInspector'
import { operationRelativePath, templates, type OperationKind, type TemplateContext } from './templates'

export type TemplateExpectation = TemplateContext & {
  kind: OperationKind
  path?: string
}

export class TemplateTester {
  constructor(private readonly files: FileInspector) {}

  async expectSeededOperation(expectation: TemplateExpectation) {
    const relPath = expectation.path ?? operationRelativePath(expectation.kind, expectation)
    const builder = templates[expectation.kind]
    const expected = builder(expectation)
    await this.files.expectExact(relPath, expected)
  }
}
