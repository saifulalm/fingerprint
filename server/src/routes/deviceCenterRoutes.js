// Device Center routes — administrasi perangkat Hikvision.
//
// Hanya aksi yang benar-benar didukung firmware perangkat yang diekspos.
// Penambahan & penghapusan user di PERANGKAT tidak didukung (probe live:
// UserInfo/Add → notSupport, UserInfo/Delete → badParameters). Yang tersedia:
//   - ubah nama / tipe / masa berlaku  (Modify)
//   - aktifkan / nonaktifkan user       (Modify dengan Valid.enable)
//   - hapus dari daftar APLIKASI       (baris device_users, bukan perangkat)
//   - pemetaan nomor ID                 (tabel employee_id_aliases)
import { Router } from 'express';
import {
  getCenterOverview,
  getCenterUsers,
  getCenterConflicts,
  getIdAliasSuggestions,
  putCenterUser,
  putCenterUserStatus,
  deleteCenterUser,
  postSyncName,
  postIdAlias,
  deleteIdAlias,
  getCenterAudit,
} from '../controllers/deviceCenterController.js';

import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/overview', asyncHandler(getCenterOverview));
router.get('/users', asyncHandler(getCenterUsers));
router.get('/conflicts', asyncHandler(getCenterConflicts));
router.get('/id-alias/suggestions', asyncHandler(getIdAliasSuggestions));
router.get('/audit', asyncHandler(getCenterAudit));
router.put('/users', asyncHandler(putCenterUser));
router.put('/users/status', asyncHandler(putCenterUserStatus));
router.delete('/users', asyncHandler(deleteCenterUser));
router.post('/sync-name', asyncHandler(postSyncName));
router.post('/id-alias', asyncHandler(postIdAlias));
router.delete('/id-alias', asyncHandler(deleteIdAlias));

export default router;
