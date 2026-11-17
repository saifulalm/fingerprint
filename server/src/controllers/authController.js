// Auth controller — issues a signed JWT token
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import prisma from '../db.js';
import { verifyAdminCredentials } from '../middleware/auth.js';
import { resetLoginAttempts } from '../middleware/rateLimit.js';

const SECRET = (config.sessionSecret || 'fp-secret') + '-fp-auth';

async function logAudit(action, detail, user) {
  try {
    await prisma.auditLog.create({ data: { action, detail, user } });
  } catch (err) {
    // Audit gagal menulis harus TERLIHAT. `catch (_) {}` membuat jejak audit
    // bolong tanpa jejak apa pun — persis bug yang mematikan audit sejak Oktober.
    console.warn(`[Audit] gagal menulis audit "${action}":`, err.message);
  }
}

export async function login(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username dan password wajib diisi' });
  }

  // Perbandingan waktu-tetap: waktu response tidak membocorkan apakah
  // username-nya benar atau hanya passwordnya yang salah.
  if (verifyAdminCredentials(username, password)) {
    const token = jwt.sign(
      { username, loginAt: new Date().toISOString() },
      SECRET,
      { expiresIn: '8h' }
    );

    // Login berhasil → reset penghitung percobaan gagal.
    resetLoginAttempts(req);

    req.session.user = { username };
    await logAudit('login', `Login berhasil`, username);

    return res.json({
      success: true,
      token,
      username,
      message: 'Login berhasil'
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Username atau password salah'
  });
}

export async function logout(req, res) {
  const username = req.session?.user?.username || 'admin';
  req.session.destroy(async (err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Logout gagal' });
    }
    await logAudit('logout', `Logout`, username);
    res.json({ success: true, message: 'Logout berhasil' });
  });
}

export async function me(req, res) {
  if (req.user) {
    return res.json({ authenticated: true, user: req.user });
  }
  if (req.session?.user) {
    return res.json({ authenticated: true, user: req.session.user });
  }
  res.status(401).json({ authenticated: false, error: 'Belum terautentikasi' });
}
