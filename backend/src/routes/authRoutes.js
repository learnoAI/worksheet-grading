"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const authController_1 = require("../controllers/authController");
const utils_1 = require("../middleware/utils");
const router = express_1.default.Router();
// Login route
router.post('/login', [
    (0, express_validator_1.body)('username').notEmpty().withMessage('Username is required'),
    (0, express_validator_1.body)('password').notEmpty().withMessage('Password is required')
], (0, utils_1.asHandler)(authController_1.login));
// Get current user route (protected)
router.get('/me', utils_1.auth, (0, utils_1.asHandler)(authController_1.getCurrentUser));
exports.default = router;
