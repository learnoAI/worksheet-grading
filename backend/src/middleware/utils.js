"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asHandler = exports.authorizeRoles = exports.auth = void 0;
const auth_1 = require("./auth");
/**
 * Helper function to fix TypeScript type compatibility with Express middleware.
 * This allows us to use these middleware functions in Express routes without type errors.
 */
// Type assertion helper for authentication middleware
exports.auth = auth_1.authenticate;
// Type assertion helper for authorization middleware
const authorizeRoles = (roles) => {
    return (0, auth_1.authorize)(roles);
};
exports.authorizeRoles = authorizeRoles;
// Type assertion helper for controller functions
const asHandler = (controller) => {
    return controller;
};
exports.asHandler = asHandler;
