#!/usr/bin/env python3
"""Foreground image owner and private RPC transport for the popup previewer.

Yazi keeps its original terminal and handles all input. The owner only serializes
image output, retains one committed image for reattach, and cleans up its IDs.
Without a nested tmux popup, run delegates to ordinary Yazi.
"""

from __future__ import annotations

import argparse
import collections
import dataclasses
import json
import os
import pathlib
import selectors
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import termios
import threading

sys.dont_write_bytecode = True
from preview import PLACEHOLDER, ImageSession, clear_placeholder_cells, parse_icat

MAX_REQUEST = 32768
MAX_RESPONSE = 4 * 1024 * 1024
MAX_IMAGE = 64 * 1024 * 1024
OPTION = "@yazi-kitty-socket"


def tmux(*args: str, env: dict[str, str] | None = None) -> str:
    result = subprocess.run(
        ["tmux", *args], env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, timeout=3, check=True,
    )
    return result.stdout.strip()


def physical_cells() -> tuple[int, int]:
    """Nested Yazi's CSI cell estimate can be wrong; ask its real caller."""
    pane = os.environ["TMUX_PANE"]
    caller = tmux("display-message", "-p", "-t", pane, "#{__tmux_popup_caller}")
    parent_pane, separator, parent_tmux = caller.partition(":")
    if not separator or not parent_pane.startswith("%") or not parent_tmux:
        raise ValueError("popup has no original terminal context")
    env = dict(os.environ, TMUX=parent_tmux)
    env.pop("TMUX_PANE", None)
    value = tmux(
        "display-message", "-p", "-t", parent_pane,
        "#{client_cell_width} #{client_cell_height}", env=env,
    )
    width, height = map(int, value.split())
    if not (1 <= width <= 512 and 1 <= height <= 512):
        raise ValueError("original terminal has no pixel cell dimensions")
    return width, height


def validated_socket(value: str) -> pathlib.Path:
    path = pathlib.Path(value)
    parent = path.parent
    directory = parent.lstat()
    endpoint = path.lstat()
    if (
        parent.resolve().parent != pathlib.Path("/tmp").resolve()
        or not parent.name.startswith(f"ykp-{os.getuid()}-")
        or not stat.S_ISDIR(directory.st_mode)
        or directory.st_uid != os.getuid()
        or stat.S_IMODE(directory.st_mode) != 0o700
        or not stat.S_ISSOCK(endpoint.st_mode)
        or endpoint.st_uid != os.getuid()
        or stat.S_IMODE(endpoint.st_mode) != 0o600
    ):
        raise ValueError("unsafe Kitty-preview socket")
    return path


def rpc(value: str, request: dict) -> dict:
    path = validated_socket(value)
    data = json.dumps(request, ensure_ascii=False).encode() + b"\n"
    if len(data) > MAX_REQUEST:
        raise ValueError("preview request is too large")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as peer:
        peer.settimeout(60)
        peer.connect(str(path))
        peer.sendall(data)
        response = bytearray()
        while not response.endswith(b"\n"):
            block = peer.recv(65536)
            if not block:
                raise ValueError("image owner disconnected")
            response.extend(block)
            if len(response) > MAX_RESPONSE:
                raise ValueError("preview response is too large")
    return json.loads(response)


def write_terminal(data: bytes) -> None:
    view = memoryview(data)
    while view:
        try:
            count = os.write(sys.stdout.fileno(), view)
        except InterruptedError:
            continue
        if count == 0:
            raise OSError("terminal stopped accepting image data")
        view = view[count:]


@dataclasses.dataclass
class Peer:
    socket: socket.socket
    data: bytearray = dataclasses.field(default_factory=bytearray)
    request: dict | None = None


@dataclasses.dataclass
class Encoder:
    serial: int
    image_id: int
    peer: Peer
    process: subprocess.Popen
    path: str
    area: tuple[int, int]
    thread: threading.Thread | None = None
    cancelled: threading.Event = dataclasses.field(default_factory=threading.Event)


class Owner:
    def __init__(self, server: socket.socket, endpoint: str, args: list[str]) -> None:
        self.endpoint = endpoint
        self.selector = selectors.DefaultSelector()
        self.selector.register(server, selectors.EVENT_READ, "listen")
        self.server = server
        # One decoder runs at a time. Its replacement joins it before starting;
        # only the latest completion can be useful to the frontend.
        self.events = collections.deque(maxlen=1)
        self.read_wake, self.write_wake = os.pipe()
        os.set_blocking(self.read_wake, False)
        os.set_blocking(self.write_wake, False)
        self.selector.register(self.read_wake, selectors.EVENT_READ, "wake")
        self.session = ImageSession(2, write_terminal)
        self.encoder: Encoder | None = None
        self.cells: tuple[int, int] | None = None
        self.peers: dict[int, Peer] = {}
        self.frontend_id: str | None = None
        self.prepared: dict[str, tuple[str, int, int, tuple[int, ...]]] = {}
        self.current_preview: tuple[str, int, int, tuple[int, ...]] | None = None
        self.clear_requests = 0
        self.stopping = False
        self.pane = os.environ["TMUX_PANE"]
        self.previous_socket = tmux("show-options", "-pqv", "-t", self.pane, OPTION)
        env = dict(os.environ, YAZI_KITTY_SOCKET=endpoint, YAZI_KITTY_HELPER=str(pathlib.Path(__file__).resolve()))
        self.frontend = subprocess.Popen(["yazi", *args], env=env)
        try:
            tmux("set-option", "-p", "-t", self.pane, OPTION, endpoint)
        except (OSError, subprocess.SubprocessError):
            self.frontend.terminate()
            self.frontend.wait(timeout=5)
            raise

    def detach_peer(self, peer: Peer) -> None:
        descriptor = peer.socket.fileno()
        self.peers.pop(descriptor, None)
        try:
            self.selector.unregister(peer.socket)
        except (KeyError, ValueError):
            pass
        peer.socket.close()

    def reply(self, peer: Peer, response: dict) -> None:
        try:
            body = json.dumps(response, ensure_ascii=False).encode() + b"\n"
            if len(body) > MAX_RESPONSE:
                raise ValueError("preview grid is too large")
            peer.socket.settimeout(2)
            peer.socket.sendall(body)
        except OSError:
            if peer.request and peer.request.get("action") == "prepare":
                self.session.cancel(peer.request["serial"])
        finally:
            self.detach_peer(peer)

    def cancel_encoder(self) -> None:
        encoder, self.encoder = self.encoder, None
        if encoder is None:
            return
        encoder.cancelled.set()
        self.session.cancel(encoder.serial)
        if encoder.process.poll() is None:
            try:
                os.killpg(encoder.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if encoder.thread:
            encoder.thread.join(timeout=2)
            if encoder.thread.is_alive():
                raise RuntimeError("image decoder did not stop")
        if encoder.peer.socket.fileno() >= 0:
            self.reply(encoder.peer, {"cancelled": True})

    def encode(self, encoder: Encoder) -> None:
        data = bytearray()
        errors = bytearray()
        failure = None
        reader = selectors.DefaultSelector()
        for pipe, label in ((encoder.process.stdout, "image"), (encoder.process.stderr, "error")):
            os.set_blocking(pipe.fileno(), False)
            reader.register(pipe, selectors.EVENT_READ, label)
        try:
            while reader.get_map() and not encoder.cancelled.is_set():
                for key, _ in reader.select(timeout=0.1):
                    block = os.read(key.fileobj.fileno(), 65536)
                    if not block:
                        reader.unregister(key.fileobj)
                    elif key.data == "image":
                        data.extend(block)
                        if len(data) > MAX_IMAGE:
                            raise ValueError("image exceeds the preview transport limit")
                    elif len(errors) < 8192:
                        errors.extend(block[:8192 - len(errors)])
            if not encoder.cancelled.is_set() and encoder.process.wait(timeout=5):
                raise ValueError(errors.decode(errors="replace").strip() or "Kitty could not decode this image")
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            failure = str(error)
            if encoder.process.poll() is None:
                try:
                    os.killpg(encoder.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        finally:
            reader.close()
            encoder.process.wait()
            encoder.process.stdout.close()
            encoder.process.stderr.close()
            if not encoder.cancelled.is_set():
                self.events.append((encoder, bytes(data), failure))
            try:
                os.write(self.write_wake, b"\0")
            except (BlockingIOError, OSError):
                pass

    def prepare(self, peer: Peer, request: dict) -> None:
        if request.get("pid") != self.frontend.pid:
            self.reply(peer, {"fallback": True})
            return
        serial, width, height = request["serial"], request["width"], request["height"]
        x, y = request["x"], request["y"]
        if (any(isinstance(n, bool) or not isinstance(n, int) or n < 1 for n in (serial, width, height))
                or any(isinstance(n, bool) or not isinstance(n, int) or n < 0 for n in (x, y))
                or width * height > 100000):
            raise ValueError("invalid preview dimensions, position, or generation")
        if serial <= self.session.serial:
            self.reply(peer, {"cancelled": True})
            return
        self.cancel_encoder()
        self.prepared.clear()
        image_id = self.session.begin(serial)
        if not isinstance(request["path"], str):
            raise ValueError("invalid image path")
        path = pathlib.Path(request["path"])
        if not path.is_absolute() or not path.is_file():
            raise ValueError("image is not a local file")
        if not isinstance(request["image_path"], str):
            raise ValueError("invalid thumbnail path")
        image_path = pathlib.Path(request["image_path"])
        if not image_path.is_absolute() or not image_path.is_file():
            raise ValueError("thumbnail is not a local file")
        try:
            self.cells = physical_cells()
        except (OSError, ValueError, subprocess.SubprocessError):
            if self.cells is None:
                raise ValueError("cannot get the physical terminal cell size")
        cell_width, cell_height = self.cells
        frontend_id = request.get("frontend_id")
        if frontend_id is not None and (not isinstance(frontend_id, str) or not frontend_id.isdecimal()):
            raise ValueError("invalid Yazi instance ID")
        self.frontend_id = frontend_id or self.frontend_id
        args = [
            "kitten", "icat", "--unicode-placeholder", "--transfer-mode", "stream",
            "--passthrough", "none", "--stdin", "no", "--align", "left", "--loop", "0",
            "--place", f"{width}x{height}@0x0",
            "--use-window-size", f"{width},{height},{width*cell_width},{height*cell_height}",
            "--image-id", str(image_id), "--", str(image_path),
        ]
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        encoder = Encoder(serial, image_id, peer, process, str(path), (x, y))
        self.encoder = encoder
        encoder.thread = threading.Thread(target=self.encode, args=(encoder,), daemon=True)
        encoder.thread.start()

    def clear_if_left(self, path: str) -> bool:
        if not isinstance(path, str):
            raise ValueError("invalid hovered path")
        if self.current_preview is None or self.current_preview[0] == path:
            return False
        _, x, y, row_widths = self.current_preview
        screen = tmux("capture-pane", "-p", "-t", self.pane)
        spaces = clear_placeholder_cells(screen, x, y, row_widths)
        self.session.discard()
        if spaces:
            write_terminal(spaces)
        self.current_preview = None
        return bool(spaces)

    def dispatch(self, peer: Peer, request: dict) -> None:
        peer.request = request
        action = request.get("action")
        if action == "prepare":
            self.prepare(peer, request)
        elif action == "show":
            token = request["token"]
            metadata = self.prepared.pop(token, None)
            shown = self.session.commit(token)
            if shown:
                if metadata is None:
                    raise ValueError("committed preview has no area metadata")
                self.current_preview = metadata
                self.prepared.clear()
            self.reply(peer, {"shown": shown})
        elif action == "clear":
            self.clear_requests += 1
            self.reply(peer, {"cleared": self.clear_if_left(request["path"])})
        elif action == "refresh":
            refreshed = self.session.refresh()
            if self.frontend_id:
                subprocess.run(
                    ["ya", "emit-to", self.frontend_id, "peek", "--force"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3,
                )
            self.reply(peer, {"refreshed": refreshed})
        elif action == "status":
            self.reply(peer, {"pid": self.frontend.pid, "serial": self.session.serial,
                              "image_id": self.session.current[0] if self.session.current else None,
                              "cells": self.cells, "frontend_id": self.frontend_id,
                              "owned": len(self.session.owned),
                              "encoding": self.encoder is not None,
                              "path": self.current_preview[0] if self.current_preview else None,
                              "clear_requests": self.clear_requests})
        else:
            raise ValueError("unknown image-owner action")

    def read_peer(self, peer: Peer) -> None:
        try:
            block = peer.socket.recv(65536)
            if not block:
                if self.encoder and self.encoder.peer is peer:
                    self.cancel_encoder()
                else:
                    self.detach_peer(peer)
                return
            if peer.request is not None:
                raise ValueError("one request is allowed per connection")
            peer.data.extend(block)
            if len(peer.data) > MAX_REQUEST:
                raise ValueError("preview request is too large")
            if b"\n" in peer.data:
                line, rest = peer.data.split(b"\n", 1)
                if rest.strip():
                    raise ValueError("unexpected preview request data")
                request = json.loads(line)
                if not isinstance(request, dict):
                    raise ValueError("invalid image-owner request")
                self.dispatch(peer, request)
        except (KeyError, OSError, ValueError, subprocess.SubprocessError) as error:
            if peer.socket.fileno() >= 0:
                self.reply(peer, {"error": str(error)})

    def completed_images(self) -> None:
        while self.events:
            encoder, data, failure = self.events.popleft()
            if encoder is not self.encoder:
                continue
            self.encoder = None
            if failure:
                self.session.cancel(encoder.serial)
                self.reply(encoder.peer, {"error": failure})
                continue
            try:
                preview = parse_icat(data, encoder.image_id)
                token = self.session.prepare(encoder.serial, preview)
                if token is None:
                    self.reply(encoder.peer, {"cancelled": True})
                else:
                    x, y = encoder.area
                    self.prepared[token] = (encoder.path, x, y, tuple(row.count(PLACEHOLDER) for row in preview.rows))
                    self.reply(encoder.peer, {"token": token, "rows": preview.rows, "color": preview.color})
            except ValueError as error:
                self.session.cancel(encoder.serial)
                self.reply(encoder.peer, {"error": str(error)})

    def serve(self) -> int:
        old_wakeup = signal.set_wakeup_fd(self.write_wake)
        old_handlers = {}
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGCHLD):
            old_handlers[sig] = signal.getsignal(sig)
            def handle(signum, _frame):
                if signum != signal.SIGCHLD:
                    self.stopping = True
            signal.signal(sig, handle)
        try:
            while not self.stopping and self.frontend.poll() is None:
                for key, _ in self.selector.select(timeout=1):
                    if key.data == "listen":
                        connection, _ = self.server.accept()
                        if len(self.peers) >= 8:
                            connection.close()
                            continue
                        connection.setblocking(False)
                        peer = Peer(connection)
                        self.peers[connection.fileno()] = peer
                        self.selector.register(connection, selectors.EVENT_READ, peer)
                    elif key.data == "wake":
                        try:
                            os.read(self.read_wake, 65536)
                        except BlockingIOError:
                            pass
                        self.completed_images()
                    else:
                        self.read_peer(key.data)
            return self.frontend.poll() or 0
        finally:
            self.cancel_encoder()
            if self.frontend.poll() is None:
                self.frontend.terminate()
                try:
                    self.frontend.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.frontend.kill()
                    self.frontend.wait()
            try:
                self.session.close()
            except OSError:
                pass  # A closed terminal cannot receive graphics cleanup.
            try:
                if tmux("show-options", "-pqv", "-t", self.pane, OPTION) == self.endpoint:
                    try:
                        previous = str(validated_socket(self.previous_socket)) if self.previous_socket else None
                    except (OSError, ValueError):
                        previous = None
                    if previous:
                        tmux("set-option", "-p", "-t", self.pane, OPTION, previous)
                    else:
                        tmux("set-option", "-pu", "-t", self.pane, OPTION)
            except (OSError, subprocess.SubprocessError):
                pass  # The owning tmux pane may already have been removed.
            for peer in tuple(self.peers.values()):
                self.detach_peer(peer)
            signal.set_wakeup_fd(old_wakeup)
            for sig, handler in old_handlers.items():
                signal.signal(sig, handler)
            self.selector.close()
            os.close(self.read_wake)
            os.close(self.write_wake)


def popup_terminal() -> bool:
    """An inherited tmux environment does not prove ownership of this PTY."""
    if os.environ.get("__tmux_popup_name") != "yazi_pwd" or not all(
        os.environ.get(name) for name in ("KITTY_WINDOW_ID", "TMUX", "TMUX_PANE")
    ) or not all(os.isatty(fd) for fd in (0, 1)):
        return False
    try:
        pane_tty = tmux("display-message", "-p", "-t", os.environ["TMUX_PANE"], "#{pane_tty}")
        return all(os.path.samefile(os.ttyname(fd), pane_tty) for fd in (0, 1))
    except (OSError, subprocess.SubprocessError):
        return False


def run(args: list[str]) -> int:
    if not popup_terminal():
        for name in ("YAZI_KITTY_SOCKET", "YAZI_KITTY_HELPER"):
            os.environ.pop(name, None)
        os.execvp("yazi", ["yazi", *args])
    original_tty = termios.tcgetattr(0) if os.isatty(0) else None
    try:
        with tempfile.TemporaryDirectory(prefix=f"ykp-{os.getuid()}-", dir="/tmp") as directory:
            endpoint = str(pathlib.Path(directory) / "s")
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
                server.bind(endpoint)
                os.chmod(endpoint, 0o600)
                server.listen(8)
                owner = Owner(server, endpoint, args)
                return owner.serve()
    finally:
        if original_tty is not None:
            try:
                termios.tcsetattr(0, termios.TCSADRAIN, original_tty)
            except termios.error:
                pass


def refresh(endpoint: str) -> int:
    """The popup-open callback addresses only its existing private image owner."""
    try:
        rpc(endpoint, {"action": "refresh"})
    except (OSError, ValueError):
        pass
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("run", "refresh", "prepare", "show", "clear", "status"))
    parser.add_argument("args", nargs=argparse.REMAINDER)
    opts = parser.parse_args()
    if opts.action == "run":
        return run(opts.args)
    if opts.action == "refresh":
        return refresh(opts.args[0])
    endpoint = os.environ["YAZI_KITTY_SOCKET"]
    request = {"action": opts.action}
    if opts.action == "prepare":
        serial, path, image_path, x, y, width, height = opts.args
        request.update(serial=int(serial), path=path, image_path=image_path,
                       x=int(x), y=int(y), width=int(width), height=int(height),
                       pid=os.getppid(), frontend_id=os.environ.get("YAZI_ID"))
    elif opts.action == "show":
        request["token"] = opts.args[0]
    elif opts.action == "clear":
        request["path"] = opts.args[0]
    try:
        response = rpc(endpoint, request)
    except (OSError, ValueError) as error:
        # An inherited or closed owner must not replace another app's preview.
        response = {"fallback": True} if opts.action == "prepare" else {"error": str(error)}
    print(json.dumps(response, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
