import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { db } from '../../database.js';
import { requireApiKey } from '../../auth/authMiddleware.js';

export const clientsRouter = Router();

clientsRouter.get('/', requireApiKey('read'), (req: Request, res: Response): void => {
  const clients = db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();
  res.status(200).json({
    success: true,
    data: clients,
    message: 'Clientes recuperados com sucesso',
  });
});

clientsRouter.post('/', requireApiKey('write'), (req: Request, res: Response): void => {
  const { name, email, phone } = req.body;
  if (!name || !email) {
    res.status(422).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'name e email são obrigatórios' },
    });
    return;
  }

  const existing = db.prepare('SELECT id FROM clients WHERE email = ?').get(email);
  if (existing) {
    res.status(409).json({
      success: false,
      error: { code: 'EMAIL_EXISTS', message: 'Cliente já cadastrado com este email' },
    });
    return;
  }

  const id = `cli_${crypto.randomUUID()}`;
  db.prepare('INSERT INTO clients (id, name, email, phone, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    name,
    email,
    phone || null,
    new Date().toISOString()
  );

  const created = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  res.status(201).json({
    success: true,
    data: created,
    message: 'Cliente cadastrado com sucesso',
  });
});
