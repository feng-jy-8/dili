import assert from 'node:assert/strict';
import test from 'node:test';
import { compatibleFlowchartSource } from '../../client/mermaid-source';

test('flowchart compatibility converts escaped label quotes and preserves code, paths and comments', () => {
  const source = String.raw`flowchart TD
    %% Keep the comment: "context.call(\"xxx\")"
    A["context.call(\"xxx\", ...) and context.call_to_end(\"xxx\", ...)"] --> B{"Ready?"}
    B --> C["C:\users\robot\\"]
    C --> D["already #quot;quoted#quot;<br/>next line"]`;
  const compatible = compatibleFlowchartSource(source);
  assert.ok(compatible.includes('context.call(#quot;xxx#quot;, ...) and context.call_to_end(#quot;xxx#quot;, ...)'));
  assert.equal(compatible.split('\n')[1], source.split('\n')[1]);
  assert.equal(compatible.split('\n')[3], source.split('\n')[3]);
  assert.equal(compatible.split('\n')[4], source.split('\n')[4]);
  assert.equal(compatibleFlowchartSource(compatible), compatible);
});

test('compatibility leaves other languages, valid quotes, and incomplete labels unchanged', () => {
  for (const source of [String.raw`sequenceDiagram
    Alice->>Bob: context.call(\"xxx\")`, 'flowchart TD\n A["Hello"] --> B["World"]', String.raw`flowchart TD
    A["context.call(\"xxx\", ...)`]) {
    assert.equal(compatibleFlowchartSource(source), source);
  }
});
