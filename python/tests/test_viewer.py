import json
import math
import socket
import urllib.request
import warnings

import pytest

import geomcore_viewer as gv
from geomcore_viewer import PALETTE, Server, Viewer


class Point3D:
    def __init__(self, x, y, z=0.0):
        self.x, self.y, self.z = x, y, z


class Plane:
    def eval_point(self, u, v):
        return Point3D(u, v, 0.0)


@pytest.fixture
def server(tmp_path):
    srv = Server(tmp_path, port=0).start()
    yield srv
    srv.stop()


def _scene(server):
    with urllib.request.urlopen(f"{server.url}/api/scene", timeout=5) as res:
        return json.loads(res.read())


def _ids(server):
    return [o["id"] for o in _scene(server)["objects"]]


def make(server, **kw):
    return Viewer(url=server.url, open_browser=False, **kw)


def test_add_streams_point_with_label_and_palette_color(server):
    view = make(server, title="demo")
    handle = view.add(Point3D(1, 2, 3), label="A")
    scene = _scene(server)
    assert handle.id == "A"
    [obj] = scene["objects"]
    assert obj["geom"] == {"type": "point", "p": [1.0, 2.0, 3.0]}
    assert obj["label"] == "A" and obj["source"] == "Point3D"
    assert obj["style"]["color"] == PALETTE[0]
    assert scene["title"] == "demo" and scene["run"] == view.run


def test_same_label_updates_in_place_and_keeps_color(server):
    view = make(server)
    view.add(Point3D(0, 0), label="x")
    view.add(Point3D(9, 9), label="other")
    view.add(Point3D(1, 0), label="x")
    objs = {o["id"]: o for o in _scene(server)["objects"]}
    assert list(objs) == ["x", "other"]
    assert objs["x"]["geom"]["p"] == [1.0, 0.0, 0.0]
    assert objs["x"]["style"]["color"] == PALETTE[0]


def test_relabelled_result_drops_stale_members(server):
    view = make(server)
    view.add(("points", [Point3D(0, 0), Point3D(1, 0)]), label="P")
    assert _ids(server) == ["P₁", "P₂"]
    view.add(("empty", None), label="P")
    [note] = _scene(server)["objects"]
    assert note["id"] == "P·note" and note["geom"]["text"] == "P: ∅" and "style" not in note


def test_several_objects_get_subscripted_labels(server):
    handles = make(server).add(Point3D(0, 0), Point3D(1, 1), label="Q")
    assert [h.id for h in handles] == ["Q₁", "Q₂"]


def test_unlabelled_objects_get_unique_ids(server):
    view = make(server)
    a, b = view.add(Point3D(0, 0)), view.add(Point3D(1, 0))
    assert a.id != b.id and _ids(server) == [a.id, b.id]


def test_new_viewer_replaces_scene_and_keep_accumulates(server):
    make(server).add(Point3D(0, 0), label="a")
    make(server).add(Point3D(0, 0), label="b")
    assert _ids(server) == ["b"]
    make(server, keep=True).add(Point3D(0, 0), label="c")
    assert _ids(server) == ["b", "c"]


def test_handle_update_and_remove(server):
    view = make(server)
    handle = view.add(Point3D(0, 0), label="a")
    handle.update(color="#000000", width=4)
    assert _scene(server)["objects"][0]["style"] == {"color": "#000000", "width": 4}
    with pytest.raises(TypeError, match="colour"):
        handle.update(colour="red")
    handle.remove()
    assert _ids(server) == []


def test_remove_label_with_special_characters(server):
    view = make(server)
    handle = view.add(Point3D(0, 0), label="a/b c₁")
    assert _ids(server) == ["a/b c₁"]
    handle.remove()
    assert _ids(server) == []


def test_surface_gets_default_window_from_scene(server):
    view = make(server)
    view.add(Point3D(2, 0, 0))
    view.add(Plane(), label="pl")
    plane = _scene(server)["objects"][1]
    assert plane["geom"]["window"] == {"u": [-3.0, 3.0], "v": [-3.0, 3.0]}
    view.add(Plane(), label="pl", u=(0, 1))
    assert _scene(server)["objects"][1]["geom"]["window"]["u"] == [0.0, 1.0]


def test_extras_are_validated(server):
    view = make(server)
    view.add(Point3D(0, 0), label="a", foci=True)
    assert _scene(server)["objects"][0]["extras"] == {"foci": True}
    with pytest.raises(TypeError, match="colour"):
        view.add(Point3D(0, 0), colour="red")


def test_nan_geometry_is_rejected(server):
    view = make(server)
    with pytest.raises(ValueError, match="bad.*NaN"):
        view.add(Point3D(math.nan, 0), label="bad")
    assert view.objects == {} and _ids(server) == []


def test_escape_hatches_coerce_inputs(server):
    view = make(server)
    view.polyline(((0, 0), (1, 1)), label="pl")
    view.mesh([(0, 0, 0), (1, 0, 0), (0, 1, 0)], (i for i in range(3)), label="m")
    view.arrow((0, 0, 0), Point3D(1, 0, 0), label="ar")
    view.text([1, 1], 42, label="tx")
    geoms = {o["id"]: o["geom"] for o in _scene(server)["objects"]}
    assert geoms["pl"] == {"type": "polyline", "points": [[0.0, 0.0, 0.0], [1.0, 1.0, 0.0]]}
    assert geoms["m"]["indices"] == [0, 1, 2]
    assert geoms["ar"] == {"type": "arrow", "at": [0.0, 0.0, 0.0], "vec": [1.0, 0.0, 0.0]}
    assert geoms["tx"] == {"type": "text", "at": [1.0, 1.0, 0.0], "text": "42"}


def test_offline_buffers_warns_once_then_flushes(tmp_path):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    view = Viewer(url=f"http://127.0.0.1:{port}", open_browser=False, spawn=False)
    with pytest.warns(RuntimeWarning, match="no geomcore-viewer"):
        view.add(Point3D(0, 0), label="a")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        view.add(Point3D(1, 0), label="b")
    saved = json.loads(view.save(tmp_path / "s.json").read_text())
    assert saved["version"] == 2 and [o["id"] for o in saved["objects"]] == ["a", "b"]
    srv = Server(tmp_path, port=port).start()
    try:
        view.add(Point3D(2, 0), label="c")
        assert _ids(srv) == ["a", "b", "c"]
    finally:
        srv.stop()


def test_module_level_add_uses_latest_viewer(server):
    view = make(server)
    gv.add(Point3D(0, 0), label="m")
    assert gv.viewer() is view and _ids(server) == ["m"]
    gv.clear()
    assert _ids(server) == []


def test_argument_errors(server):
    with pytest.raises(TypeError):
        make(server).add()
    with pytest.raises(ValueError):
        Viewer(view="4d")


def test_duplicate_note_ids_collapse_to_one_handle(server):
    handle = make(server).add(("tangent", None), label="X")
    assert isinstance(handle, gv.Handle) and handle.id == "X·note"
    [obj] = _scene(server)["objects"]
    assert obj["id"] == "X·note" and obj["geom"]["level"] == "warn"


def test_bad_style_value_leaves_viewer_usable(server):
    view = make(server)
    with pytest.raises(ValueError, match="bad.*NaN"):
        view.add(Point3D(0, 0), label="bad", opacity=math.nan)
    with pytest.raises(TypeError, match="bad"):
        view.add(Point3D(0, 0), label="bad", width=object())
    assert view.objects == {}
    view.add(Point3D(1, 0), label="good")
    assert _ids(server) == ["good"]


def test_server_rejection_does_not_block_later_adds(server):
    view = make(server)
    with pytest.raises(RuntimeError, match="rejected"):
        view.add(Point3D(0, 0), label=5)
    view.add(Point3D(1, 0), label="good")
    assert _ids(server) == ["good"]


def test_offline_removal_is_replayed_and_scene_resent_after_restart(tmp_path):
    first = Server(tmp_path, port=0).start()
    view = Viewer(url=first.url, open_browser=False)
    handle_a = view.add(Point3D(0, 0), label="a")
    view.add(Point3D(1, 0), label="b")
    first.stop()
    with pytest.warns(RuntimeWarning, match="unreachable"):
        handle_a.remove()
    second = Server(tmp_path, port=first.port).start()
    try:
        view.add(Point3D(2, 0), label="c")
        assert _ids(second) == ["b", "c"]
    finally:
        second.stop()


def test_offline_clear_is_replayed_after_reconnect(tmp_path):
    first = Server(tmp_path, port=0).start()
    view = Viewer(url=first.url, open_browser=False, keep=True)
    view.add(Point3D(0, 0), label="a")
    first.stop()
    with pytest.warns(RuntimeWarning, match="unreachable"):
        view.clear()
    second = Server(tmp_path, port=first.port).start()
    try:
        second.state.post({"objects": [{"id": "ghost", "geom": {"type": "point", "p": [0, 0, 0]}}]})
        view.add(Point3D(1, 0), label="b")
        assert _ids(second) == ["b"]
    finally:
        second.stop()


def test_bad_update_leaves_viewer_usable(server):
    view = make(server)
    handle = view.add(Point3D(0, 0), label="a")
    with pytest.raises(ValueError, match="a: .*NaN"):
        handle.update(opacity=math.nan)
    with pytest.raises(TypeError, match="a:"):
        handle.update(width=object())
    view.add(Point3D(1, 0), label="b")
    objs = {o["id"]: o for o in _scene(server)["objects"]}
    assert list(objs) == ["a", "b"]
    assert objs["a"]["style"] == {"color": PALETTE[0]}
    assert view.objects["a"]["style"] == {"color": PALETTE[0]}
