import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Auto-cleanup the DOM after each test (mirrors Jest's built-in behaviour)
afterEach(cleanup);
