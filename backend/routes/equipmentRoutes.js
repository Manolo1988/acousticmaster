import express from "express";

const router = express.Router();

// In-memory storage for demonstration purposes
let equipmentList = [];

// Get all equipment filtered by type
router.get("/", (req, res) => {
  const { type } = req.query; // Query parameter for filtering
  const filteredList = type
    ? equipmentList.filter((item) => item.类型 === type)
    : equipmentList;
  res.json(filteredList);
});

// Add new equipment
router.post("/", (req, res) => {
  const newEquipment = { id: Date.now(), ...req.body };
  equipmentList.push(newEquipment);
  res.status(201).json(newEquipment);
});

// Update equipment by ID
router.put("/:id", (req, res) => {
  const { id } = req.params;
  const index = equipmentList.findIndex((item) => item.id === parseInt(id));
  if (index === -1) {
    return res.status(404).json({ error: "Equipment not found" });
  }
  equipmentList[index] = { ...equipmentList[index], ...req.body };
  res.json(equipmentList[index]);
});

// Delete equipment by ID
router.delete("/:id", (req, res) => {
  const { id } = req.params;
  const index = equipmentList.findIndex((item) => item.id === parseInt(id));
  if (index === -1) {
    return res.status(404).json({ error: "Equipment not found" });
  }
  const deletedItem = equipmentList.splice(index, 1);
  res.json(deletedItem[0]);
});

export default router;