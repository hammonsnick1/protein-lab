import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { defaultProfile, displayName, normalizeProfile, normalizeTeam } from "./workspace-profile.ts";

describe("stored profile", () => {
  it("reads a saved profile and trims it", () => {
    assert.deepEqual(normalizeProfile({ name: "  Ada  ", googleEmail: " ada@lab.edu ", googleConnected: true }), { name: "Ada", googleEmail: "ada@lab.edu", googleConnected: true });
  });

  it("treats anything unsaved or malformed as an empty profile", () => {
    for (const value of [null, undefined, "{}", 7, [], { name: 4, googleConnected: "yes" }]) {
      assert.deepEqual(normalizeProfile(value), { name: "", googleEmail: "", googleConnected: false });
    }
  });

  it("falls back to the default name in the greeting", () => {
    assert.equal(displayName({ name: "", googleEmail: "", googleConnected: false }), defaultProfile.name);
    assert.equal(displayName({ name: "Ada", googleEmail: "", googleConnected: false }), "Ada");
  });
});

describe("stored collaborators", () => {
  it("keeps saved members and defaults an unknown role", () => {
    assert.deepEqual(normalizeTeam([{ id: "a", name: " Bo ", email: " bo@lab.edu ", role: "Reviewer" }, { id: "b", name: "Cy", email: "cy@lab.edu", role: "Admin" }]), [
      { id: "a", name: "Bo", email: "bo@lab.edu", role: "Reviewer" },
      { id: "b", name: "Cy", email: "cy@lab.edu", role: "Member" },
    ]);
  });

  it("drops entries with neither a name nor an address", () => {
    assert.deepEqual(normalizeTeam([{ name: "", email: "" }, null, "Bo", { email: "bo@lab.edu" }]), [{ id: "bo@lab.edu", name: "bo@lab.edu", email: "bo@lab.edu", role: "Member" }]);
  });

  it("reads a missing or malformed list as nobody, so the team tile stays hidden", () => {
    for (const value of [null, undefined, {}, "[]", 0]) assert.deepEqual(normalizeTeam(value), []);
  });
});
