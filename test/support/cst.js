import assert from "node:assert/strict";

export function sourceNodes(output, source) {
  const bytes = Buffer.from(source);
  const offsets = [0];
  for (const [index, byte] of bytes.entries()) {
    if (byte === 10) offsets.push(index + 1);
  }
  const offset = (point) => {
    const [row, column] = point.split(":").map(Number);
    assert.ok(row < offsets.length, point);
    const end =
      offsets[row + 1] === undefined ? bytes.length : offsets[row + 1] - 1;
    assert.ok(column <= end - offsets[row], point);
    return offsets[row] + column;
  };
  const nodes = [];
  for (const line of output.split("\n")) {
    const match = line.match(
      /^([0-9]+:[0-9]+)[ ]+-[ ]+([0-9]+:[0-9]+)([ ]+)([^\n]*)$/,
    );
    if (match === null) continue;
    let content = match[4];
    let recovery = content.startsWith("•");
    const depth =
      match[3].length -
      Math.max(0, line.indexOf("-") - 1 - match[2].length) +
      Number(recovery);
    if (recovery) content = content.slice(1);
    if (content.startsWith("`")) continue;
    const field = content.match(/^([a-z_]+): /)?.[1];
    let type = (
      field === undefined ? content : content.slice(field.length + 2)
    ).replace(/[ ]+`[^\n]*$/, "");
    if (type.startsWith("•")) {
      recovery = true;
      type = type.slice(1);
    }
    const start = offset(match[1]);
    const end = offset(match[2]);
    assert.ok(end >= start, line);
    nodes.push({
      type,
      field,
      depth,
      recovery,
      start,
      end,
      text: bytes.subarray(start, end).toString(),
    });
  }
  assert.ok(nodes.length > 0, output);
  return nodes;
}

export function assertSourceEnd(output, bytes) {
  const lines = bytes.toString().split("\n");
  const expected = `${lines.length - 1}:${Buffer.byteLength(lines.at(-1) ?? "")}`;
  const end = output.match(/^[0-9]+:[0-9]+ +-[ ]+([0-9]+:[0-9]+)[ ]+program/);
  assert.equal(end?.[1], expected, "parser must consume the complete source");
}
