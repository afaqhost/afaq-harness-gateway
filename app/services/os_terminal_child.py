"""Single-purpose child process wrapper for OS terminal PTY sessions.

Runs ONLY after exec via posix_spawn in the child process.
Multithread-safe: No Python code runs between fork and exec in the parent process.
"""

from __future__ import annotations

import argparse
import fcntl
import os
import sys
import termios
import time


def main() -> None:
    parser = argparse.ArgumentParser(description="OS terminal PTY child wrapper")
    parser.add_argument("--cwd", required=True, help="Working directory for the shell session")
    parser.add_argument("shells", nargs="+", help="Shell binary candidates in fallback priority order")
    args = parser.parse_args()

    # 1. Acquire controlling terminal.
    # In posix_spawn, setsid may already have been activated. Ignore EPERM.
    try:
        os.setsid()
    except OSError:
        pass

    try:
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)
    except OSError:
        pass

    # 2. Change working directory.
    try:
        os.chdir(args.cwd)
    except OSError as exc:
        try:
            os.write(2, f"\r\n\033[1;31mchdir failed\033[0m: {exc}\r\n".encode())
            time.sleep(0.5)
        except Exception:
            pass
        os._exit(126)

    # 3. Set terminal environment variables.
    os.environ["TERM"] = os.environ.get("TERM") or "xterm-256color"
    os.environ["AFAQ_TERMINAL"] = "1"
    os.environ["COLORTERM"] = os.environ.get("COLORTERM", "truecolor")

    # 4. Exec the first usable login shell.
    last_err: Exception | None = None
    for candidate in args.shells:
        try:
            os.execvp(candidate, [candidate, "-l"])
        except OSError as exc:
            last_err = exc
            continue

    # If all candidates failed, write clear error output and exit.
    try:
        os.write(2, f"\r\n\033[1;31mexec failed\033[0m: {last_err}\r\n".encode())
        os.write(2, f"  tried: {' '.join(args.shells)}\r\n".encode())
        os.write(2, "\r\nThis often means:\r\n".encode())
        os.write(2, "  - the shell binary has lost its execute permission\r\n".encode())
        os.write(2, "  - the binary lives on a noexec-mounted filesystem\r\n".encode())
        os.write(2, "  - the container has no_new_privs set (execve denied)\r\n".encode())
        os.write(2, "\r\nPress Ctrl+D or close this tab.\r\n".encode())
        try:
            import select
            select.select([0], [], [], 0.1)
        except Exception:
            pass
        try:
            time.sleep(0.2)
        except Exception:
            pass
    except Exception:
        pass

    os._exit(127)


if __name__ == "__main__":
    main()
