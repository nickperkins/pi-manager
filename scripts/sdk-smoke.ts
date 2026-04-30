// SDK smoke test — called via utilityProcess.fork() in dev.
// Kept in repo for CI use; forking removed from main after Task 10 verification.
async function main(): Promise<void> {
  try {
    const { createAgentSession, SessionManager } = await import(
      "@mariozechner/pi-coding-agent"
    );
    const { session } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
    });
    session.dispose();
    console.log("[smoke] AgentSession created and disposed successfully");
    process.exit(0);
  } catch (err) {
    console.error("[smoke] FAIL:", err);
    process.exit(1);
  }
}

main();
