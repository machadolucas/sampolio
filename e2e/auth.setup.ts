import { test as setup, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

setup("sign in to the seeded synthetic Alex account", async ({ request }) => {
  const response = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: "http://localhost:4999" },
    data: { email: "alex@example.com", password: "Synthetic-Only-2026!" },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await mkdir("test-results/.auth", { recursive: true });
  await request.storageState({ path: "test-results/.auth/alex.json" });
});
