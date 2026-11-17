// Employees routes
import { Router } from 'express';
import { getEmployees, createEmployee, updateEmployee, deleteEmployee, setEmployeeStatus, bulkCreateEmployees } from '../controllers/employeesController.js';

import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();
router.get('/',    asyncHandler(getEmployees));
router.post('/',   asyncHandler(createEmployee));
router.put('/:employeeNo', asyncHandler(updateEmployee));
router.put('/:employeeNo/status', asyncHandler(setEmployeeStatus));
router.delete('/:employeeNo', asyncHandler(deleteEmployee));
router.post('/bulk', asyncHandler(bulkCreateEmployees));
export default router;
