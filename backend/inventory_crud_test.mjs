const API_BASE = process.env.TEST_API_BASE || "http://127.0.0.1:3001";
const TABLES = {
  SPEAKER: "音箱",
  LINE_ARRAY_SUPPORT: "线阵列配套",
  AMPLIFIER: "定阻功放",
  PERIPHERAL: "周边设备",
  SUBSYSTEM: "子系统",
  LOCAL_RESOURCE: "本地静态资源管理"
};

const suffix = `AUTO_${Date.now()}`;
const createdRecords = [];
const executedTests = [];

const logStep = (message) => {
  console.log(`[TEST] ${message}`);
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const encodeTable = (table) => encodeURIComponent(table);

const request = async (path, options = {}) => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = { raw: text };
  }
  return { ok: response.ok, status: response.status, data };
};

const createRecord = async (table, payload, tag) => {
  const res = await request(`/api/inventory/${encodeTable(table)}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  assert(res.ok, `创建失败 [${table}/${tag}] status=${res.status} body=${JSON.stringify(res.data)}`);
  const id = Number(res.data?.id || 0);
  assert(id > 0, `创建返回无效ID [${table}/${tag}]`);
  createdRecords.push({ table, id, tag });
  return res.data;
};

const updateRecord = async (table, id, payload, tag) => {
  const res = await request(`/api/inventory/${encodeTable(table)}/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  assert(res.ok, `更新失败 [${table}/${tag}] status=${res.status} body=${JSON.stringify(res.data)}`);
  return res.data;
};

const deleteRecord = async (table, id, tag) => {
  const res = await request(`/api/inventory/${encodeTable(table)}/${id}`, { method: "DELETE" });
  assert(res.ok, `单删失败 [${table}/${tag}] status=${res.status} body=${JSON.stringify(res.data)}`);
  return res.data;
};

const batchDelete = async (table, ids, tag) => {
  const res = await request(`/api/inventory/${encodeTable(table)}/batch-delete`, {
    method: "POST",
    body: JSON.stringify({ ids })
  });
  assert(res.ok, `批删失败 [${table}/${tag}] status=${res.status} body=${JSON.stringify(res.data)}`);
  return res.data;
};

const listTable = async (table) => {
  const res = await request(`/api/inventory/${encodeTable(table)}`);
  assert(res.ok, `查询列表失败 [${table}] status=${res.status}`);
  assert(Array.isArray(res.data), `列表返回格式错误 [${table}]`);
  return res.data;
};

const getDetail = async (table, params) => {
  const search = new URLSearchParams(params).toString();
  const res = await request(`/api/inventory/${encodeTable(table)}/detail?${search}`);
  assert(res.ok, `查询详情失败 [${table}] status=${res.status} body=${JSON.stringify(res.data)}`);
  return res.data;
};

const analyzeAmplifierMatch = async (payload) => {
  const res = await request(`/api/plan/amplifier-match-analysis`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  assert(res.ok, `功放匹配分析失败 status=${res.status} body=${JSON.stringify(res.data)}`);
  return res.data;
};

const removeFromCleanup = (table, id) => {
  const idx = createdRecords.findIndex((r) => r.table === table && r.id === id);
  if (idx >= 0) createdRecords.splice(idx, 1);
};

const expectWithUnit = (value, unit, title) => {
  const text = String(value || "").trim();
  assert(text.endsWith(unit), `${title} 未自动补单位，当前值: ${text}`);
};

const runSpeakerTests = async () => {
  logStep("音箱+线阵列配套：创建/查询/更新/批删/单删与联动删除");

  const brand = `TEST_BRAND_${suffix}`;
  const lineName = `TEST_LINE_SPK_${suffix}`;
  const lineModel = `TEST-LINE-${suffix}`;

  const lineCreate = await createRecord(TABLES.SPEAKER, {
    产品类型: "线阵列音箱",
    品牌: brand,
    产品名称: lineName,
    型号: lineModel,
    市场价: 1888,
    额定阻抗: "8",
    额定功率: "500",
    灵敏度: "96",
    最大声压级: "132",
    水平覆盖角: "90",
    垂直覆盖角: "10",
    面高: 0.55,
    功能: ["主扩声", "吊装"],
    lineArraySupport: {
      subwoofer: {
        类型: "次低音箱",
        产品名称: `TEST_SUB_${suffix}`,
        型号: `TEST-SUB-${suffix}`,
        市场价: 999,
        额定阻抗: "8",
        额定功率: "700",
        灵敏度: "95",
        最大声压级: "129",
        水平覆盖角: "100",
        垂直覆盖角: "40",
        面高: 0.6,
        品牌: brand
      },
      hanger: {
        产品名称: `TEST_HANGER_${suffix}`,
        型号: `TEST-HANGER-${suffix}`,
        市场价: 333
      }
    }
  }, "speaker-line-create");

  const lineSpeakerId = Number(lineCreate.id);
  assert(Number(lineCreate.lineArraySupportInserted || 0) === 2, "线阵列配套未正确插入2条");

  const speakerRowsAfterCreate = await listTable(TABLES.SPEAKER);
  const createdSpeaker = speakerRowsAfterCreate.find((r) => Number(r.id) === lineSpeakerId);
  assert(createdSpeaker, "未在音箱列表中找到新建线阵列音箱");
  expectWithUnit(createdSpeaker.额定阻抗, "Ω", "音箱额定阻抗");
  expectWithUnit(createdSpeaker.额定功率, "W", "音箱额定功率");
  expectWithUnit(createdSpeaker.灵敏度, "dB", "音箱灵敏度");
  expectWithUnit(createdSpeaker.最大声压级, "dB", "音箱最大声压级");

  const supportRowsAfterCreate = await listTable(TABLES.LINE_ARRAY_SUPPORT);
  const linkedSupports = supportRowsAfterCreate.filter((r) => Number(r.main_id) === lineSpeakerId);
  assert(linkedSupports.length === 2, "线阵列主音箱未正确关联2条配套记录");

  const subwoofer = linkedSupports.find((r) => String(r.用途 || "").trim() === "次低音箱");
  assert(subwoofer, "未找到次低音箱配套");
  expectWithUnit(subwoofer.额定阻抗, "Ω", "配套次低音额定阻抗");
  expectWithUnit(subwoofer.额定功率, "W", "配套次低音额定功率");

  const speakerUpdatePayload = {
    ...createdSpeaker,
    市场价: 1999,
    额定阻抗: "6",
    额定功率: "600",
    灵敏度: "97",
    最大声压级: "133"
  };
  delete speakerUpdatePayload.id;
  delete speakerUpdatePayload.isChild;
  await updateRecord(TABLES.SPEAKER, lineSpeakerId, speakerUpdatePayload, "speaker-line-update");

  const updatedSpeakerRows = await listTable(TABLES.SPEAKER);
  const updatedSpeaker = updatedSpeakerRows.find((r) => Number(r.id) === lineSpeakerId);
  assert(updatedSpeaker, "更新后未找到线阵列音箱");
  expectWithUnit(updatedSpeaker.额定阻抗, "Ω", "更新后音箱额定阻抗");
  expectWithUnit(updatedSpeaker.额定功率, "W", "更新后音箱额定功率");

  const detailSpeaker = await getDetail(TABLES.SPEAKER, { model: lineModel });
  assert(Number(detailSpeaker.id) === lineSpeakerId, "详情接口返回的线阵列音箱ID不匹配");

  const batchSpeaker = await createRecord(TABLES.SPEAKER, {
    产品类型: "全频音箱",
    品牌: brand,
    产品名称: `TEST_BATCH_SPK_${suffix}`,
    型号: `TEST-BATCH-SPK-${suffix}`,
    市场价: 1280,
    额定阻抗: "8",
    额定功率: "300",
    灵敏度: "94",
    最大声压级: "126",
    水平覆盖角: "90",
    垂直覆盖角: "60",
    面高: 0.45,
    功能: ["辅助扩声"]
  }, "speaker-batch-create");

  const batchSpeakerId = Number(batchSpeaker.id);
  const batchDeleteResult = await batchDelete(TABLES.SPEAKER, [batchSpeakerId], "speaker-batch-delete");
  assert(Number(batchDeleteResult.affectedRows || 0) >= 1, "音箱批删未生效");
  removeFromCleanup(TABLES.SPEAKER, batchSpeakerId);

  const singleDeleteResult = await deleteRecord(TABLES.SPEAKER, lineSpeakerId, "speaker-line-single-delete");
  assert(Number(singleDeleteResult.affectedRows || 0) >= 1, "音箱单删未生效");
  removeFromCleanup(TABLES.SPEAKER, lineSpeakerId);

  const supportRowsAfterDelete = await listTable(TABLES.LINE_ARRAY_SUPPORT);
  const remainLinkedSupports = supportRowsAfterDelete.filter((r) => Number(r.main_id) === lineSpeakerId);
  assert(remainLinkedSupports.length === 0, "删除线阵列主音箱后，配套数据未联动删除");

  executedTests.push(
    "音箱(含线阵列配套)创建成功并自动插入2条配套",
    "音箱阻抗/功率/灵敏度/声压级自动补单位保存",
    "音箱详情查询(model)成功",
    "音箱批量删除成功",
    "音箱单条删除成功并联动删除线阵列配套"
  );
};

const runLineArraySupportDirectTests = async () => {
  logStep("线阵列配套（直接表）CRUD");

  const rec1 = await createRecord(TABLES.LINE_ARRAY_SUPPORT, {
    类型: "次低音箱",
    品牌: `TEST_BRAND_${suffix}`,
    产品名称: `TEST_DIRECT_SUB_${suffix}`,
    型号: `TEST-DIRECT-SUB-${suffix}`,
    市场价: 666,
    额定阻抗: "4",
    额定功率: "450",
    灵敏度: "92",
    最大声压级: "122",
    水平覆盖角: "80",
    垂直覆盖角: "40",
    面高: 0.45,
    用途: "次低音箱"
  }, "line-support-direct-create-main");

  const rec2 = await createRecord(TABLES.LINE_ARRAY_SUPPORT, {
    类型: "线阵列音箱吊挂架",
    品牌: `TEST_BRAND_${suffix}`,
    产品名称: `TEST_DIRECT_HANGER_${suffix}`,
    型号: `TEST-DIRECT-HANGER-${suffix}`,
    市场价: 88,
    用途: "挂架"
  }, "line-support-direct-create-hanger");

  const id1 = Number(rec1.id);
  const id2 = Number(rec2.id);

  const lineSupportRowsBeforeUpdate = await listTable(TABLES.LINE_ARRAY_SUPPORT);
  const lineSupportBeforeUpdate = lineSupportRowsBeforeUpdate.find((r) => Number(r.id) === id1);
  assert(lineSupportBeforeUpdate, "线阵列配套直接表更新前未找到记录");
  const lineSupportUpdatePayload = {
    ...lineSupportBeforeUpdate,
    额定阻抗: "6",
    额定功率: "500"
  };
  delete lineSupportUpdatePayload.id;
  delete lineSupportUpdatePayload.isChild;
  await updateRecord(TABLES.LINE_ARRAY_SUPPORT, id1, lineSupportUpdatePayload, "line-support-direct-update");

  const rows = await listTable(TABLES.LINE_ARRAY_SUPPORT);
  const updated = rows.find((r) => Number(r.id) === id1);
  assert(updated, "线阵列配套直接表更新后未找到记录");
  expectWithUnit(updated.额定阻抗, "Ω", "线阵列配套直接表额定阻抗");
  expectWithUnit(updated.额定功率, "W", "线阵列配套直接表额定功率");

  const batchDeleteResult = await batchDelete(TABLES.LINE_ARRAY_SUPPORT, [id2], "line-support-direct-batch-delete");
  assert(Number(batchDeleteResult.affectedRows || 0) >= 1, "线阵列配套直接表批删未生效");
  removeFromCleanup(TABLES.LINE_ARRAY_SUPPORT, id2);

  const singleDeleteResult = await deleteRecord(TABLES.LINE_ARRAY_SUPPORT, id1, "line-support-direct-single-delete");
  assert(Number(singleDeleteResult.affectedRows || 0) >= 1, "线阵列配套直接表单删未生效");
  removeFromCleanup(TABLES.LINE_ARRAY_SUPPORT, id1);

  executedTests.push(
    "线阵列配套直接表创建成功（次低音箱/挂架）",
    "线阵列配套直接表更新时单位自动补全",
    "线阵列配套直接表批删与单删成功"
  );
};

const runAmplifierMatchAnalysisTests = async () => {
  logStep("功放匹配分析：匹配重算/不匹配推荐/候选过滤");

  const brand = `TEST_MATCH_BRAND_${suffix}`;
  const speakerName = `TEST_MATCH_SPK_${suffix}`;
  const speakerModel = `TEST-MATCH-SPK-${suffix}`;
  const ampNormalName = `TEST_MATCH_AMP_NORMAL_${suffix}`;
  const ampNormalModel = `TEST-MATCH-AMP-NORMAL-${suffix}`;
  const ampStrongName = `TEST_MATCH_AMP_STRONG_${suffix}`;
  const ampStrongModel = `TEST-MATCH-AMP-STRONG-${suffix}`;
  const ampWrongImpName = `TEST_MATCH_AMP_WRONG_IMP_${suffix}`;
  const ampWrongImpModel = `TEST-MATCH-AMP-WRONG-IMP-${suffix}`;

  const speaker = await createRecord(TABLES.SPEAKER, {
    产品类型: "全频音箱",
    品牌: brand,
    产品名称: speakerName,
    型号: speakerModel,
    市场价: 1680,
    额定阻抗: "8",
    额定功率: "300",
    灵敏度: "95",
    最大声压级: "128",
    水平覆盖角: "90",
    垂直覆盖角: "60",
    面高: 0.48,
    功能: ["主扩声"]
  }, "amp-match-speaker-create");

  const ampNormal = await createRecord(TABLES.AMPLIFIER, {
    类型: "二通道功放",
    品牌: brand,
    产品名称: ampNormalName,
    型号: ampNormalModel,
    市场价: 3200,
    额定功率: "500",
    额定阻抗: "8",
    通道数: "2"
  }, "amp-match-normal-create");

  const ampStrong = await createRecord(TABLES.AMPLIFIER, {
    类型: "二通道功放",
    品牌: brand,
    产品名称: ampStrongName,
    型号: ampStrongModel,
    市场价: 4200,
    额定功率: "800",
    额定阻抗: "8",
    通道数: "2"
  }, "amp-match-strong-create");

  const ampWrongImp = await createRecord(TABLES.AMPLIFIER, {
    类型: "二通道功放",
    品牌: brand,
    产品名称: ampWrongImpName,
    型号: ampWrongImpModel,
    市场价: 3600,
    额定功率: "900",
    额定阻抗: "4",
    通道数: "2"
  }, "amp-match-wrong-imp-create");

  const meetingMatch = await analyzeAmplifierMatch({
    scenario: "MEETING_ROOM",
    speaker: {
      model: speakerModel,
      quantity: 4
    },
    currentAmplifier: {
      model: ampNormalModel
    }
  });
  assert(meetingMatch.current?.matched === true, "会议室场景应匹配当前功放");
  assert(Number(meetingMatch.current?.requiredQuantity || 0) === 2, "会议室场景功放数量重算应为2");

  const lectureMismatch = await analyzeAmplifierMatch({
    scenario: "LECTURE_HALL",
    speaker: {
      model: speakerModel,
      quantity: 4
    },
    currentAmplifier: {
      model: ampNormalModel
    }
  });
  assert(lectureMismatch.current?.matched === false, "报告厅场景应判定当前功放不匹配");
  assert(lectureMismatch.needsConfirmation === true, "不匹配时应要求二次确认");
  assert(String(lectureMismatch.recommendation?.model || "") === ampStrongModel, "推荐功放应为高功率匹配型号");
  assert(Number(lectureMismatch.recommendation?.requiredQuantity || 0) === 2, "推荐功放数量应重算为2");

  const meetingCandidates = await analyzeAmplifierMatch({
    scenario: "MEETING_ROOM",
    speaker: {
      model: speakerModel,
      quantity: 4
    }
  });
  const candidateModels = new Set((Array.isArray(meetingCandidates.recommended) ? meetingCandidates.recommended : []).map((item) => String(item?.model || "")));
  assert(candidateModels.has(ampNormalModel), "候选功放应包含匹配的普通功放");
  assert(candidateModels.has(ampStrongModel), "候选功放应包含匹配的高功率功放");
  assert(!candidateModels.has(ampWrongImpModel), "候选功放不应包含阻抗不匹配型号");

  const speakerId = Number(speaker.id);
  const ampNormalId = Number(ampNormal.id);
  const ampStrongId = Number(ampStrong.id);
  const ampWrongImpId = Number(ampWrongImp.id);

  await deleteRecord(TABLES.AMPLIFIER, ampWrongImpId, "amp-match-cleanup-wrong-imp");
  await deleteRecord(TABLES.AMPLIFIER, ampStrongId, "amp-match-cleanup-strong");
  await deleteRecord(TABLES.AMPLIFIER, ampNormalId, "amp-match-cleanup-normal");
  await deleteRecord(TABLES.SPEAKER, speakerId, "amp-match-cleanup-speaker");

  removeFromCleanup(TABLES.AMPLIFIER, ampWrongImpId);
  removeFromCleanup(TABLES.AMPLIFIER, ampStrongId);
  removeFromCleanup(TABLES.AMPLIFIER, ampNormalId);
  removeFromCleanup(TABLES.SPEAKER, speakerId);

  executedTests.push(
    "功放匹配分析：会议室场景匹配并正确重算数量",
    "功放匹配分析：报告厅场景不匹配并返回推荐与二次确认",
    "功放匹配分析：功放候选只返回与音箱阻抗/功率匹配型号"
  );
};

const runCommonTableCrud = async (table, baseName, payload1, payload2, updatePayload) => {
  logStep(`${table} CRUD`);

  const create1 = await createRecord(table, payload1, `${baseName}-create-1`);
  const create2 = await createRecord(table, payload2, `${baseName}-create-2`);
  const id1 = Number(create1.id);
  const id2 = Number(create2.id);

  await updateRecord(table, id1, updatePayload, `${baseName}-update`);

  const rows = await listTable(table);
  const row1 = rows.find((r) => Number(r.id) === id1);
  assert(row1, `${table} 更新后未找到记录`);

  if (Object.prototype.hasOwnProperty.call(updatePayload, "额定阻抗")) {
    expectWithUnit(row1.额定阻抗, "Ω", `${table}额定阻抗`);
  }
  if (Object.prototype.hasOwnProperty.call(updatePayload, "额定功率")) {
    expectWithUnit(row1.额定功率, "W", `${table}额定功率`);
  }

  if (payload1.型号 || payload1.产品名称) {
    const params = payload1.型号 ? { model: payload1.型号 } : { name: payload1.产品名称 };
    const detail = await getDetail(table, params);
    assert(Number(detail.id) === id1, `${table}详情接口返回ID不匹配`);
  }

  const batchDeleteResult = await batchDelete(table, [id2], `${baseName}-batch-delete`);
  assert(Number(batchDeleteResult.affectedRows || 0) >= 1, `${table}批删未生效`);
  removeFromCleanup(table, id2);

  const singleDeleteResult = await deleteRecord(table, id1, `${baseName}-single-delete`);
  assert(Number(singleDeleteResult.affectedRows || 0) >= 1, `${table}单删未生效`);
  removeFromCleanup(table, id1);
};

const runLocalResourceCrud = async () => {
  logStep("本地静态资源 CRUD");

  const rec1 = await createRecord(TABLES.LOCAL_RESOURCE, {
    图片名称: `TEST_RESOURCE_${suffix}`,
    图片解释: "自动化测试资源",
    资源类型: "文字",
    资源内容: `TEST_CONTENT_${suffix}`,
    插入章节: "设备介绍",
    使用场景: "通用",
    是否启用: "是"
  }, "local-resource-create-1");

  const rec2 = await createRecord(TABLES.LOCAL_RESOURCE, {
    图片名称: `TEST_RESOURCE_2_${suffix}`,
    图片解释: "自动化测试资源2",
    资源类型: "文字",
    资源内容: `TEST_CONTENT_2_${suffix}`,
    插入章节: "方案设计",
    使用场景: "会议室",
    是否启用: "是"
  }, "local-resource-create-2");

  const id1 = Number(rec1.id);
  const id2 = Number(rec2.id);

  await updateRecord(TABLES.LOCAL_RESOURCE, id1, {
    图片解释: "自动化测试资源-已更新",
    资源内容: `TEST_CONTENT_UPDATED_${suffix}`
  }, "local-resource-update");

  const rows = await listTable(TABLES.LOCAL_RESOURCE);
  const row1 = rows.find((r) => Number(r.id) === id1);
  assert(row1, "本地静态资源更新后未找到记录");

  const batchDeleteResult = await batchDelete(TABLES.LOCAL_RESOURCE, [id2], "local-resource-batch-delete");
  assert(Number(batchDeleteResult.affectedRows || 0) >= 1, "本地静态资源批删未生效");
  removeFromCleanup(TABLES.LOCAL_RESOURCE, id2);

  const singleDeleteResult = await deleteRecord(TABLES.LOCAL_RESOURCE, id1, "local-resource-single-delete");
  assert(Number(singleDeleteResult.affectedRows || 0) >= 1, "本地静态资源单删未生效");
  removeFromCleanup(TABLES.LOCAL_RESOURCE, id1);

  executedTests.push(
    "本地静态资源创建/更新/批删/单删成功"
  );
};

const cleanupCreatedRecords = async () => {
  if (createdRecords.length === 0) return;
  logStep(`开始清理残留测试数据: ${createdRecords.length} 条`);

  for (const record of [...createdRecords].reverse()) {
    try {
      await request(`/api/inventory/${encodeTable(record.table)}/${record.id}`, { method: "DELETE" });
      removeFromCleanup(record.table, record.id);
      console.log(`[CLEANUP] removed ${record.table}#${record.id} (${record.tag})`);
    } catch (error) {
      console.error(`[CLEANUP] failed ${record.table}#${record.id}:`, error.message);
    }
  }
};

const main = async () => {
  const health = await request("/api/inventory/speaker-metadata");
  assert(health.ok, `后端不可用，无法开始测试: status=${health.status}`);

  await runSpeakerTests();
  await runLineArraySupportDirectTests();
  await runAmplifierMatchAnalysisTests();

  await runCommonTableCrud(
    TABLES.AMPLIFIER,
    "amplifier",
    {
      类型: "二通道功放",
      品牌: `TEST_BRAND_${suffix}`,
      产品名称: `TEST_AMP_${suffix}`,
      型号: `TEST-AMP-${suffix}`,
      市场价: 2200,
      额定功率: "300",
      额定阻抗: "8",
      通道数: "2"
    },
    {
      类型: "四通道功放",
      品牌: `TEST_BRAND_${suffix}`,
      产品名称: `TEST_AMP2_${suffix}`,
      型号: `TEST-AMP2-${suffix}`,
      市场价: 2800,
      额定功率: "450",
      额定阻抗: "4",
      通道数: "4"
    },
    {
      额定功率: "350",
      额定阻抗: "6",
      市场价: 2300
    }
  );
  executedTests.push("定阻功放创建/更新/详情/批删/单删成功");

  await runCommonTableCrud(
    TABLES.PERIPHERAL,
    "peripheral",
    {
      类型: "调音台",
      品牌: `TEST_BRAND_${suffix}`,
      产品名称: `TEST_PERI_${suffix}`,
      型号: `TEST-PERI-${suffix}`,
      输入通道: 12,
      输出通道: 6,
      市场价: 1500
    },
    {
      类型: "音频处理器",
      品牌: `TEST_BRAND_${suffix}`,
      产品名称: `TEST_PERI2_${suffix}`,
      型号: `TEST-PERI2-${suffix}`,
      输入通道: 8,
      输出通道: 4,
      市场价: 1800
    },
    {
      市场价: 1650
    }
  );
  executedTests.push("周边设备创建/更新/详情/批删/单删成功");

  await runCommonTableCrud(
    TABLES.SUBSYSTEM,
    "subsystem",
    {
      类型: "中控系统",
      品牌: `TEST_BRAND_${suffix}`,
      产品名称: `TEST_SUBSYS_${suffix}`,
      型号: `TEST-SUBSYS-${suffix}`,
      数量: 1,
      市场价: 5000,
      场景: "通用"
    },
    {
      类型: "矩阵",
      品牌: `TEST_BRAND_${suffix}`,
      产品名称: `TEST_SUBSYS2_${suffix}`,
      型号: `TEST-SUBSYS2-${suffix}`,
      数量: 1,
      市场价: 6500,
      场景: "会议室"
    },
    {
      数量: 2,
      市场价: 5200
    }
  );
  executedTests.push("子系统创建/更新/详情/批删/单删成功");

  await runLocalResourceCrud();

  console.log("\n=== TEST SUMMARY ===");
  executedTests.forEach((item, idx) => {
    console.log(`${idx + 1}. ${item}`);
  });
  console.log(`TOTAL: ${executedTests.length}`);
};

(async () => {
  try {
    await main();
    await cleanupCreatedRecords();
    console.log("\nALL TESTS PASSED, TEST DATA CLEANED");
    process.exit(0);
  } catch (error) {
    console.error("\nTEST FAILED:", error.message);
    await cleanupCreatedRecords();
    process.exit(1);
  }
})();
