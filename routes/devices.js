
const express = require('express');
const router = express.Router();
const db = require('../db/config');

// 获取设备列表
router.get('/:type', (req, res) => {
    const { type } = req.params;
    const query = `SELECT * FROM ${type}`;
    db.query(query, (err, results) => {
        if (err) {
            res.status(500).send(err);
        } else {
            res.json(results);
        }
    });
});

// 增加设备
router.post('/:type', (req, res) => {
    const { type } = req.params;
    const data = req.body;
    const query = `INSERT INTO ${type} SET ?`;
    db.query(query, data, (err, results) => {
        if (err) {
            res.status(500).send(err);
        } else {
            res.json({ id: results.insertId });
        }
    });
});

// 更新设备
router.put('/:type/:id', (req, res) => {
    const { type, id } = req.params;
    const data = req.body;
    const query = `UPDATE ${type} SET ? WHERE id = ?`;
    db.query(query, [data, id], (err, results) => {
        if (err) {
            res.status(500).send(err);
        } else {
            res.json(results);
        }
    });
});

// 删除设备
router.delete('/:type/:id', (req, res) => {
    const { type, id } = req.params;
    const query = `DELETE FROM ${type} WHERE id = ?`;
    db.query(query, id, (err, results) => {
        if (err) {
            res.status(500).send(err);
        } else {
            res.json(results);
        }
    });
});

module.exports = router;