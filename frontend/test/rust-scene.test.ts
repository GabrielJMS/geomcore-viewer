import { describe, expect, it } from "vitest";
import scene from "../../clients/rust/tests/scene.json";
import { parseDoc } from "../src/protocol";

describe("the Rust client's scene (clients/rust/tests/scene.json)", () => {
  it("parses with no problems, every object kept", () => {
    const { doc, problems } = parseDoc(scene);
    expect(problems).toEqual([]);
    expect(doc.objects.map((o) => o.id)).toEqual(scene.objects.map((o) => o.id));
    expect(doc.view).toBe("3d");
  });
});
