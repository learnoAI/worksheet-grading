"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const worksheetTemplateController_1 = require("../controllers/worksheetTemplateController");
const client_1 = require("@prisma/client");
const utils_1 = require("../middleware/utils");
const router = express_1.default.Router();
// Worksheet Template routes
router.get('/worksheet-templates', utils_1.auth, (0, utils_1.asHandler)(worksheetTemplateController_1.getAllWorksheetTemplates));
router.get('/worksheet-templates/:id', utils_1.auth, (0, utils_1.asHandler)(worksheetTemplateController_1.getWorksheetTemplateById));
// SUPERADMIN only routes
router.post('/worksheet-templates', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.SUPERADMIN]),
    (0, express_validator_1.body)('worksheetNumber').optional().isInt().withMessage('Worksheet number must be an integer')
], (0, utils_1.asHandler)(worksheetTemplateController_1.createWorksheetTemplate));
router.put('/worksheet-templates/:id', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.SUPERADMIN]),
    (0, express_validator_1.body)('worksheetNumber').optional().isInt().withMessage('Worksheet number must be an integer')
], (0, utils_1.asHandler)(worksheetTemplateController_1.updateWorksheetTemplate));
router.delete('/worksheet-templates/:id', [utils_1.auth, (0, utils_1.authorizeRoles)([client_1.UserRole.SUPERADMIN])], (0, utils_1.asHandler)(worksheetTemplateController_1.deleteWorksheetTemplate));
// Template image routes
router.post('/worksheet-templates/:id/images', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.SUPERADMIN]),
    (0, express_validator_1.body)('imageUrl').notEmpty().withMessage('Image URL is required'),
    (0, express_validator_1.body)('pageNumber').isInt().withMessage('Page number must be an integer')
], (0, utils_1.asHandler)(worksheetTemplateController_1.addTemplateImage));
router.delete('/worksheet-templates/images/:id', [utils_1.auth, (0, utils_1.authorizeRoles)([client_1.UserRole.SUPERADMIN])], (0, utils_1.asHandler)(worksheetTemplateController_1.deleteTemplateImage));
// Template question routes
router.post('/worksheet-templates/:id/questions', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.SUPERADMIN]),
    (0, express_validator_1.body)('question').notEmpty().withMessage('Question is required'),
    (0, express_validator_1.body)('answer').optional(),
    (0, express_validator_1.body)('outOf').optional().isNumeric().withMessage('Out of must be a number'),
    (0, express_validator_1.body)('skillIds').optional().isArray().withMessage('Skill IDs must be an array')
], (0, utils_1.asHandler)(worksheetTemplateController_1.addTemplateQuestion));
router.put('/worksheet-templates/questions/:id', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.SUPERADMIN]),
    (0, express_validator_1.body)('question').optional(),
    (0, express_validator_1.body)('answer').optional(),
    (0, express_validator_1.body)('outOf').optional().isNumeric().withMessage('Out of must be a number'),
    (0, express_validator_1.body)('skillIds').optional().isArray().withMessage('Skill IDs must be an array')
], (0, utils_1.asHandler)(worksheetTemplateController_1.updateTemplateQuestion));
router.delete('/worksheet-templates/questions/:id', [utils_1.auth, (0, utils_1.authorizeRoles)([client_1.UserRole.SUPERADMIN])], (0, utils_1.asHandler)(worksheetTemplateController_1.deleteTemplateQuestion));
// Math skill routes
router.get('/math-skills', utils_1.auth, (0, utils_1.asHandler)(worksheetTemplateController_1.getAllMathSkills));
router.post('/math-skills', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.SUPERADMIN]),
    (0, express_validator_1.body)('name').notEmpty().withMessage('Name is required'),
    (0, express_validator_1.body)('description').optional()
], (0, utils_1.asHandler)(worksheetTemplateController_1.createMathSkill));
exports.default = router;
