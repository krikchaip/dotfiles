"""Learn whether the program of a new pane in the popup session started.

The popup programs and the scrollback editors start through launch.py.
"""

import os
import socket
import time

from herdr_api import HerdrError
from launch import START_ENV

# How long a new pane may take to start launch.py.
PROGRAM_START_SECONDS = 5.0


class StartCheck:
    """Learn whether the program of a new pane started.

    launch.py connects to this Unix socket (its path is in `env`) before it
    runs the program. The connection closes when the program starts, with no
    data. When the program cannot start, launch.py sends the error first.
    This catches each start failure: a missing program, a file that is not a
    program, and a launcher that does not run at all. `what` names the
    program in the error of a start that takes too long.
    """

    def __init__(self, what="the popup program"):
        self.what = what

    def __enter__(self):
        import tempfile

        # A short folder: a Unix socket path must stay below 104 bytes on macOS.
        self.folder = tempfile.mkdtemp(prefix="toggle-popup-")
        path = os.path.join(self.folder, "start.sock")
        self.server = socket.socket(socket.AF_UNIX)
        try:
            self.server.bind(path)
            self.server.listen(1)
        except BaseException:
            self.__exit__()
            raise
        self.env = {START_ENV: path}
        return self

    def __exit__(self, *exc_info):
        import shutil

        self.server.close()
        shutil.rmtree(self.folder, ignore_errors=True)

    def wait(self):
        """Return when the program started. Raise HerdrError when it did not."""
        timeout = PROGRAM_START_SECONDS
        deadline = time.monotonic() + timeout
        data = b""
        try:
            self.server.settimeout(timeout)
            client, _ = self.server.accept()
            with client:
                while True:
                    client.settimeout(max(deadline - time.monotonic(), 0.01))
                    chunk = client.recv(4096)
                    if not chunk:
                        break
                    data += chunk
        except TimeoutError:
            raise HerdrError(f"{self.what} did not start in {timeout:g} seconds") from None
        if data:
            raise HerdrError(data.decode(errors="replace").strip())
