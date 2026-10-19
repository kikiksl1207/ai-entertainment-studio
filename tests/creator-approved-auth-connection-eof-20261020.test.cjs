"use strict";

const { registerEofCases } = require("./owner-auth-connection/support/eof-cases.cjs");
registerEofCases(require("./owner-auth-connection/profiles/v6.cjs"));
