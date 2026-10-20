/** Both direct keys and pasted drafts share the same bounded wire format. */
export function sendTerminalInput(socket: Pick<WebSocket, 'send'>, data: string) {
  for (let offset = 0; offset < data.length;) {
    let end = Math.min(offset + 4096, data.length);
    // Never split a UTF-16 surrogate pair across JSON/PTY frames.
    if (end < data.length && data.charCodeAt(end - 1) >= 0xd800 && data.charCodeAt(end - 1) <= 0xdbff) end--;
    socket.send(JSON.stringify({ type: 'input', data: data.slice(offset, end) }));
    offset = end;
  }
}
