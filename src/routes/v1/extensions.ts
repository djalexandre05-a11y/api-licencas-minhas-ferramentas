import { Router, Request, Response } from 'express';
import { db } from '../../database.js';
import { requireApiKey } from '../../auth/authMiddleware.js';

export const extensionsRouter = Router();

/**
 * @route GET /api/v1/extensions
 * @desc Lista todas as extensões registradas no ecossistema (dszap, tele, sender, youtube, etc.)
 */
extensionsRouter.get(
  '/',
  (req: Request, res: Response): void => {
    const rows = db.prepare('SELECT * FROM extensions ORDER BY name ASC').all();
    res.status(200).json({
      success: true,
      data: rows,
      message: 'Extensões listadas com sucesso',
    });
  }
);

/**
 * @route POST /api/v1/extensions
 * @desc Cadastrar nova extensão/ferramenta
 */
extensionsRouter.post(
  '/',
  (req: Request, res: Response): void => {
    const { id, name, version = 'v1.0', description = '' } = req.body;
    if (!id || !name) {
      res.status(422).json({ success: false, error: { message: 'id e name são obrigatórios' } });
      return;
    }

    const existing = db.prepare('SELECT id FROM extensions WHERE id = ?').get(id);
    if (existing) {
      res.status(409).json({ success: false, error: { message: 'Extensão já cadastrada com este ID' } });
      return;
    }

    db.prepare(`
      INSERT INTO extensions (id, name, version, description, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, version, description, new Date().toISOString());

    const created = db.prepare('SELECT * FROM extensions WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: created, message: 'Extensão cadastrada com sucesso' });
  }
);

/**
 * @route DELETE /api/v1/extensions/:id
 * @desc Excluir extensão/ferramenta
 */
extensionsRouter.delete(
  '/:id',
  (req: Request, res: Response): void => {
    const ext = db.prepare('SELECT id FROM extensions WHERE id = ?').get(req.params.id);
    if (!ext) {
      res.status(404).json({ success: false, error: { message: 'Extensão não encontrada' } });
      return;
    }

    db.prepare('DELETE FROM extensions WHERE id = ?').run(req.params.id);
    res.status(200).json({ success: true, message: 'Extensão removida com sucesso' });
  }
);
