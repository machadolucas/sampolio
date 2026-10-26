import { test, expect } from "./fixtures";

test("virtual WebAuthn registers, renames, signs in and deletes a passkey", async ({
  page,
  context,
}) => {
  test.skip(
    test.info().project.name !== "desktop",
    "One Chromium virtual-authenticator integration run is sufficient",
  );
  // Use a separate real password session for Sam so sign-out never invalidates
  // the shared Alex storage-state session used by other acceptance tests.
  const signIn = await context.request.post("/api/auth/sign-in/email", {
    headers: { Origin: "http://localhost:4999" },
    data: { email: "sam@example.com", password: "Synthetic-Only-2026!" },
  });
  expect(signIn.ok(), await signIn.text()).toBeTruthy();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  try {
    await page.goto("/settings?tab=account");
    await page
      .getByRole("button", { name: "Add passkey", exact: true })
      .click();
    await expect(
      page.getByText("Passkey added", { exact: true }),
    ).toBeVisible();
    expect(
      (await cdp.send("WebAuthn.getCredentials", { authenticatorId }))
        .credentials,
    ).toHaveLength(1);
    const passkeys = page.getByRole("list", { name: "Your passkeys" });
    await passkeys.getByRole("button", { name: /^Rename / }).click();
    const rename = page.getByRole("dialog", { name: "Rename passkey" });
    await rename
      .getByLabel("Name", { exact: true })
      .fill("Synthetic browser key");
    await rename.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      passkeys.getByText("Synthetic browser key", { exact: true }),
    ).toBeVisible();
    const signOut = await context.request.post("/api/auth/sign-out", {
      headers: { Origin: "http://localhost:4999" },
      data: {},
    });
    expect(signOut.ok(), await signOut.text()).toBeTruthy();
    // Exercise the explicit button rather than an automatic autofill ceremony.
    await page.addInitScript(() =>
      Object.defineProperty(
        PublicKeyCredential,
        "isConditionalMediationAvailable",
        { value: async () => false, configurable: true },
      ),
    );
    await page.goto("/auth/signin");
    await page
      .getByRole("button", { name: "Sign in with passkey", exact: true })
      .click();
    await expect(page).not.toHaveURL(/auth\/signin/);
    await expect(page.getByRole("main")).toBeVisible();
    await page.goto("/settings?tab=account");
    await page
      .getByRole("button", {
        name: "Delete Synthetic browser key",
        exact: true,
      })
      .click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Delete passkey?",
    });
    await confirmation
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(confirmation).toBeHidden();
    await expect(
      page.getByText("No passkeys yet.", { exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await cdp.detach();
  }
});
