import { createLogger } from "../src";

describe("Logger", () => {
  it("should log info messages", () => {
    const logger = createLogger({ label: "test", level: "info" });
    logger.info("Hello from test");
    expect(true).toBe(true); // just a dummy test
  });
});
