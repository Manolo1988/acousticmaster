import { useState, useMemo, useEffect } from 'react';
import React from 'react';
import { 
  Scenario, Page, SolutionTab, ResultTab, AcousticParams, DesignState, 
  EquipmentItem, SolutionResult, Equipment, HistoryItem, User,
  TableType, DbInventoryItem 
} from '../types';
import { DEFAULT_PARAMS, MIC_TYPES, MOCK_HISTORY } from '../constants';
import { processAcousticCommand } from '../services/geminiService';

export const useAcousticLogic = () => {
  // --- 基础页面与 UI 状态 ---
  const [currentPage, setCurrentPage] = useState<Page>(Page.SOLUTION);
  const [currentSolutionTab, setCurrentSolutionTab] = useState<SolutionTab>(SolutionTab.DESIGN);
  const [currentResultTab, setCurrentResultTab] = useState<ResultTab>(ResultTab.PLAN);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInputValue, setChatInputValue] = useState("");
  const [isProcessingAi, setIsProcessingAi] = useState(false);
  const [isGeneratingDocs, setIsGeneratingDocs] = useState(false);
  const [editingItem, setEditingItem] = useState<{ resIdx: number, itemIdx: number, item: EquipmentItem } | null>(null);
  const [previewHistoryItem, setPreviewHistoryItem] = useState<HistoryItem | null>(null);
  const [users, setUsers] = useState<User[]>([]); // 确保初始值为数组
  const [userRoleFilter, setUserRoleFilter] = useState<string>('ALL');  // --- 方案设计核心状态 ---
  const [userNameFilter, setUserNameFilter] = useState("");
  const [searchFilters, setSearchFilters] = useState({ 品牌: '', 用途: '', 场景: '' });
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  // --- 资源管理状态 (对应 MySQL 数据库) ---
  const [activeTable, setActiveTable] = useState<TableType>(TableType.SPEAKER);
  const [inventory, setInventory] = useState<DbInventoryItem[]>([]);
  const defaultProjectName = `声学项目_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_01`;
  const [designState, setDesignState] = useState<DesignState>({
  
    projectName: defaultProjectName,
    scenario: Scenario.MEETING_ROOM,
    params: { ...DEFAULT_PARAMS },
    blueprint: null,
    isDesigned: false,
    chatHistory: [{ role: 'ai', text: '您好，我是您的声学助理。请描述您的场景需求，我会自动同步参数并优化方案。', timestamp: new Date() }],
    results: [],
    activeResultIndex: 0
  });

  // --- [核心修改] 多表切换与主子表关联逻辑 ---
  const displayInventory = useMemo(() => {
    let result = [...inventory];
    // 处理“音箱”分类：需要将主音箱与“线阵列配套”通过 main_id 关联并染色
    if (activeTable === TableType.SPEAKER) {
      const speakers = inventory.filter(item => !item.main_id || item.main_id === 0);
      const children = inventory.filter(item => item.main_id && item.main_id > 0);
      
      const sortedResult: DbInventoryItem[] = [];
      speakers.forEach(s => {
        sortedResult.push(s);
        // 寻找该音箱关联的配套子项并标记 isChild
        const matchedChildren = children.filter(c => c.main_id === s.id);
        matchedChildren.forEach(c => {
          sortedResult.push({ ...c, isChild: true });
        });
      });
      return sortedResult;
    }
    if (searchFilters.品牌) {
      result = result.filter(item => item.品牌.toLowerCase().includes(searchFilters.品牌.toLowerCase()));
    }
    if (searchFilters.用途 && activeTable === TableType.SPEAKER) {
      result = result.filter(item => Array.isArray(item.用途) ? item.用途.includes(searchFilters.用途) : item.用途 === searchFilters.用途);
    }

    // 3. 排序逻辑
    if (sortConfig) {
      result.sort((a: any, b: any) => {
        const valA = a[sortConfig.key] || 0;
        const valB = b[sortConfig.key] || 0;
        return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
      });
    }
    return result;

    // 处理其他分类 (功放、周边设备、其他设备等)
    //return inventory.filter(item => item.类型 === activeTable || (activeTable === TableType.OTHER && !item.类型));
  }, [inventory, searchFilters, sortConfig, activeTable]);

  // --- 方案参数处理 ---
  const handleParamChange = (key: keyof AcousticParams | 'scenario', value: any) => {
    if (key === 'scenario') {
      setDesignState(prev => ({ ...prev, scenario: value }));
      return;
    }
    setDesignState(prev => ({ ...prev, params: { ...prev.params, [key]: value } }));
  };

  const handleUpdateProjectName = (name: string) => {
    setDesignState(prev => ({ ...prev, projectName: name }));
  };

  const handleMicChange = (id: string, count: number) => {
    setDesignState(prev => ({
      ...prev,
      params: { ...prev.params, mics: prev.params.mics.map(m => m.id === id ? { ...m, count } : m) }
    }));
  };

  const addMic = () => {
    setDesignState(prev => ({
      ...prev,
      params: { ...prev.params, mics: [...prev.params.mics, { id: Date.now().toString(), type: MIC_TYPES[0], count: 1 }] }
    }));
  };

  const removeMic = (id: string) => {
    setDesignState(prev => ({ ...prev, params: { ...prev.params, mics: prev.params.mics.filter(m => m.id !== id) } }));
  };

  // --- AI 交互与设计逻辑 ---
  const handleSendMessage = async () => {
    if (!chatInputValue.trim() || isProcessingAi) return;
    const userMsg = chatInputValue;
    setChatInputValue("");
    setDesignState(prev => ({
      ...prev,
      chatHistory: [...prev.chatHistory, { role: 'user', text: userMsg, timestamp: new Date() }]
    }));
    setIsProcessingAi(true);
    
    const aiResult = await processAcousticCommand(userMsg);
    setDesignState(prev => {
      let nextParams = { ...prev.params };
      if (aiResult) {
        nextParams = { ...nextParams, ...aiResult };
        if (aiResult.suggestedMics) {
          nextParams.mics = aiResult.suggestedMics.map((m: any, i: number) => ({ id: `ai-${Date.now()}-${i}`, ...m }));
        }
      }
      return {
        ...prev,
        params: nextParams,
        chatHistory: [...prev.chatHistory, { 
          role: 'ai', 
          text: aiResult ? `已识别到您的需求，参数已同步。是否基于这些参数生成方案？` : `收到，正在分析您的声学需求...`, 
          timestamp: new Date() 
        }]
      };
    });
    setIsProcessingAi(false);
  };

  const startDesign = () => {
    setIsProcessingAi(true);
    setTimeout(() => {
      const mockResults: SolutionResult[] = [
        {
          id: 'res-1',
          title: '推荐方案 1',
          items: [
            { id: '1', type: '音箱', name: '同轴吸顶扬声器', model: 'SX60', quantity: 4 },
            { id: '2', type: '功放', name: '数字功放', model: 'SD300', quantity: 2 },
          ]
        }
      ];
      setDesignState(prev => ({ ...prev, isDesigned: true, results: mockResults, activeResultIndex: 0 }));
      setIsProcessingAi(false);
      setCurrentResultTab(ResultTab.PLAN);
    }, 1200);
  };
  const saveEdit = () => {
    if (!editingItem) return;
    const newResults = [...designState.results];
    newResults[editingItem.resIdx].items[editingItem.itemIdx] = editingItem.item;
    setDesignState(prev => ({ ...prev, results: newResults }));
    setEditingItem(null);
  };

  const handleLogout = () => {
    if (confirm('确定要退出系统吗？')) window.location.reload();
  };
// --- 1. 实现 deleteItem (方案明细中的设备删除) ---
const deleteItem = (resIdx: number, itemIdx: number) => {
  setDesignState(prev => {
    const newResults = [...prev.results];
    // 深度拷贝该方案下的 items 数组并执行删除
    newResults[resIdx] = {
      ...newResults[resIdx],
      items: newResults[resIdx].items.filter((_, i) => i !== itemIdx)
    };
    return { ...prev, results: newResults };
  });
};

// --- 2. 实现 handleGenerateReports (生成正式报告) ---
const handleGenerateReports = (scope: 'CURRENT' | 'ALL') => {
  setIsGeneratingDocs(true);
  // 模拟生成过程
  setTimeout(() => {
    setDesignState(prev => {
      const newResults = [...prev.results];
      if (scope === 'CURRENT') {
        const current = newResults[prev.activeResultIndex];
        if (current) current.wordLink = "#"; // 赋予模拟链接
      } else {
        newResults.forEach(r => r.wordLink = "#");
      }
      return { ...prev, results: newResults };
    });
    setIsGeneratingDocs(false);
    alert(scope === 'CURRENT' ? "当前方案报告已生成" : "所有方案报告已生成");
  }, 1500);
};

// --- 3. 实现 deleteUser (用户管理中的删除) ---
const deleteUser = (id: string) => {
  if (window.confirm("确定要删除该用户吗？此操作不可恢复。")) {
    setUsers(prev => prev.filter(u => u.id !== id));
  }
};
// 实现 addUser (用于 image_55065e.png)
const addUser = (user: User) => {
  setUsers(prev => [...prev, user]);
};

// 实现 updateUser (用于 image_55065e.png)
const updateUser = (user: User) => {
  setUsers(prev => prev.map(u => u.id === user.id ? user : u));
};
// --- 4. 实现 handleDownload (文件下载逻辑) ---
const handleDownload = (type: 'EXCEL' | 'WORD' | 'PNG') => {
  const fileName = designState.projectName || "声学方案";
  alert(`系统正在准备 ${fileName} 的 ${type} 文件，请稍后...`);
  // 实际项目中这里会调用 window.open(url) 或创建 <a> 标签下载
};
const handleBlueprintUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (upload) => {
      setDesignState(prev => ({ ...prev, blueprint: upload.target?.result as string }));
    };
    reader.readAsDataURL(file);
  }
};
const handleSaveEquipment = (item: Partial<DbInventoryItem>) => {
  const newItem = {
    ...item,
    id: Date.now(),
  } as DbInventoryItem;
  setInventory(prev => [...prev, newItem]);
  alert("设备录入成功！");
};

const filteredInventory = useMemo(() => {
  // 根据侧边栏选中的 TableType 过滤数据
  return inventory.filter(item => {
    if (activeTable === TableType.SPEAKER) return !item.main_id && !item.描述;
    if (activeTable === TableType.OTHER) return !!item.描述;
    return true; // 其他类型逻辑类似
  });
}, [inventory, activeTable]);
  return {
    searchFilters, setSearchFilters,
    sortConfig, setSortConfig,
    handleBlueprintUpload,
    currentPage, setCurrentPage,
    currentSolutionTab, setCurrentSolutionTab,
    currentResultTab, setCurrentResultTab,
    isChatOpen, setIsChatOpen,
    chatInputValue, setChatInputValue,
    designState, setDesignState,
    isProcessingAi, isGeneratingDocs,
    editingItem, setEditingItem,
    previewHistoryItem, setPreviewHistoryItem,
    activeTable, setActiveTable,
    inventory: filteredInventory, displayInventory,deleteItem,
    handleDownload,userNameFilter,setUserNameFilter,addUser,updateUser,users,
    // 补全 image_54f2c6.png 缺失的方法
    handleGenerateReports,
    handleSaveEquipment,
    deleteUser,
    userRoleFilter,
    setUserRoleFilter,
    setInventory,
    currentUser: { name: '张经理', role: '系统管理员', email: 'zhang@acoustic.com' },
    history: MOCK_HISTORY,
    handleParamChange, handleMicChange, addMic, removeMic,
    handleUpdateProjectName, handleSendMessage, startDesign, saveEdit, handleLogout,
    closeHistoryPreview: () => setPreviewHistoryItem(null)
  };
};