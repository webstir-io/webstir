/** A mail server that accepts every message and keeps it, for tests of email over SMTP. */
export function startSmtpServer() {
  const messages = [];
  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buffer: '', from: '', to: [], data: undefined };
        socket.write('220 localhost test SMTP\r\n');
      },
      data(socket, chunk) {
        const state = socket.data;
        state.buffer += new TextDecoder().decode(chunk);
        for (;;) {
          if (state.data !== undefined) {
            const end = state.buffer.indexOf('\r\n.\r\n');
            if (end === -1) return;
            state.data += state.buffer.slice(0, end);
            state.buffer = state.buffer.slice(end + 5);
            messages.push({ from: state.from, to: state.to, data: state.data });
            state.data = undefined;
            state.to = [];
            socket.write('250 OK\r\n');
            continue;
          }
          const lineEnd = state.buffer.indexOf('\r\n');
          if (lineEnd === -1) return;
          const line = state.buffer.slice(0, lineEnd);
          state.buffer = state.buffer.slice(lineEnd + 2);
          const command = line.slice(0, 4).toUpperCase();
          if (command === 'MAIL') state.from = /<([^>]*)>/.exec(line)?.[1] ?? '';
          if (command === 'RCPT') state.to.push(/<([^>]*)>/.exec(line)?.[1] ?? '');
          if (command === 'DATA') {
            state.data = '';
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          } else if (command === 'QUIT') {
            socket.write('221 Bye\r\n');
            socket.end();
            return;
          } else {
            socket.write(
              command === 'EHLO' || command === 'HELO' ? '250 localhost\r\n' : '250 OK\r\n',
            );
          }
        }
      },
    },
  });
  return { url: `smtp://127.0.0.1:${server.port}`, messages, stop: () => server.stop(true) };
}
