import type { Socket } from 'bun';

export interface ReceivedEmail {
  readonly from: string;
  readonly to: readonly string[];
  /** The message as sent, headers and body, with quoted-printable decoded. */
  readonly data: string;
}

export interface SmtpServer {
  readonly url: string;
  readonly messages: ReceivedEmail[];
  stop(): void;
}

/** A mail server that accepts every message and keeps it, for tests of email over SMTP. */
export function startSmtpServer(): SmtpServer {
  const messages: ReceivedEmail[] = [];
  interface State {
    buffer: string;
    from: string;
    to: string[];
    data?: string;
  }
  const server = Bun.listen<State>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buffer: '', from: '', to: [] };
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
            messages.push({
              from: state.from,
              to: state.to,
              data: decodeQuotedPrintable(state.data),
            });
            state.data = undefined;
            state.to = [];
            reply(socket, '250 OK');
            continue;
          }
          const lineEnd = state.buffer.indexOf('\r\n');
          if (lineEnd === -1) return;
          const line = state.buffer.slice(0, lineEnd);
          state.buffer = state.buffer.slice(lineEnd + 2);
          const command = line.slice(0, 4).toUpperCase();
          if (command === 'EHLO' || command === 'HELO') reply(socket, '250 localhost');
          else if (command === 'MAIL') {
            state.from = /<([^>]*)>/.exec(line)?.[1] ?? '';
            reply(socket, '250 OK');
          } else if (command === 'RCPT') {
            state.to.push(/<([^>]*)>/.exec(line)?.[1] ?? '');
            reply(socket, '250 OK');
          } else if (command === 'DATA') {
            state.data = '';
            reply(socket, '354 End data with <CR><LF>.<CR><LF>');
          } else if (command === 'QUIT') {
            reply(socket, '221 Bye');
            socket.end();
            return;
          } else reply(socket, '250 OK');
        }
      },
    },
  });
  return {
    url: `smtp://127.0.0.1:${server.port}`,
    messages,
    stop: () => server.stop(true),
  };
}

function reply(socket: Socket<unknown>, line: string): void {
  socket.write(`${line}\r\n`);
}

function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}
