"use strict";

const { registerStorageCases } = require("./owner-auth-connection/support/storage-cases.cjs");
registerStorageCases(require("./owner-auth-connection/profiles/v6.cjs"));
