import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedPeer } from "./peers.ts";

test("loopback and tailnet peers are allowed", () => {
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "100.101.102.103", "100.64.0.1", "100.127.255.254", "::ffff:100.100.1.2", "fd7a:115c:a1e0::1"]) {
    assert.ok(isAllowedPeer(address), address);
  }
});

test("LAN, public and malformed peers are refused", () => {
  for (const address of ["192.168.1.20", "10.0.0.5", "172.16.0.1", "100.63.255.255", "100.128.0.1", "8.8.8.8", "::ffff:192.168.1.2", "fe80::1", "2001:db8::1", "", undefined]) {
    assert.ok(!isAllowedPeer(address), String(address));
  }
});
