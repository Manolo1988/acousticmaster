
import { useState, useMemo } from 'react';
import { 
  Scenario, Page, SolutionTab, ResultTab, AcousticParams, DesignState, EquipmentItem, SolutionResult, Equipment, HistoryItem
} from '../types';
import { DEFAULT_PARAMS, MIC_TYPES, MOCK_EQUIPMENTS, MOCK_HISTORY } from '../constants';
import { processAcousticCommand } from '../services/geminiService';

export const useAcousticLogic = () => {
  const [currentPage, setCurrentPage] = useState<Page>(Page.SOLUTION);
  const [currentSolutionTab, setCurrentSolutionTab] = useState<SolutionTab>(SolutionTab.DESIGN);
  const [currentResultTab, setCurrentResultTab] = useState<ResultTab>(ResultTab.PLAN);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInputValue, setChatInputValue] = useState("");
  const [isProcessingAi, setIsProcessingAi] = useState(false);
  const [isGeneratingDocs, setIsGeneratingDocs] = useState(false);
  const [editingItem, setEditingItem] = useState<{ resIdx: number, itemIdx: number, item: EquipmentItem } | null>(null);
  
  const [previewHistoryItem, setPreviewHistoryItem] = useState<HistoryItem | null>(null);

  const [equipments, setEquipments] = useState<Equipment[]>(MOCK_EQUIPMENTS);
  const [equipmentSearchQuery, setEquipmentSearchQuery] = useState("");
  
  const [history, setHistory] = useState<HistoryItem[]>(MOCK_HISTORY);

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
            { id: '3', type: '话筒', name: '无线真分集话筒', model: 'KU102', quantity: 2 },
            { id: '5', type: '矩阵', name: '数字音频处理器', model: 'DM0408', quantity: 1 },
          ]
        },
        {
          id: 'res-2',
          title: '推荐方案 2',
          items: [
            { id: '1', type: '音箱', name: '壁挂会议音箱', model: 'W8', quantity: 2 },
            { id: '3', type: '话筒', name: '鹅颈会议话筒', model: 'GN30', quantity: 4 },
          ]
        }
      ];

      setDesignState(prev => ({ 
        ...prev, 
        isDesigned: true,
        results: mockResults,
        activeResultIndex: 0,
        chatHistory: [...prev.chatHistory, {
          role: 'ai',
          text: '初步方案已生成。您可以进行微调，点击右上角按钮即可选择生成文档。',
          timestamp: new Date()
        }]
      }));
      setIsProcessingAi(false);
      setCurrentResultTab(ResultTab.PLAN);
    }, 1200);
  };

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

  const deleteItem = (resIdx: number, itemIdx: number) => {
    const newResults = [...designState.results];
    newResults[resIdx].items.splice(itemIdx, 1);
    setDesignState(prev => ({ ...prev, results: newResults }));
  };

  const saveEdit = () => {
    if (!editingItem) return;
    const newResults = [...designState.results];
    newResults[editingItem.resIdx].items[editingItem.itemIdx] = editingItem.item;
    setDesignState(prev => ({ ...prev, results: newResults }));
    setEditingItem(null);
  };

  const handleGenerateReports = (scope: 'CURRENT' | 'ALL') => {
    setIsGeneratingDocs(true);
    setTimeout(() => {
      const newResults = [...designState.results];
      if (scope === 'CURRENT') {
        const current = newResults[designState.activeResultIndex];
        current.wordLink = "#"; 
        alert(`已成功生成方案 [${current.title}] 的正式文档。`);
      } else {
        newResults.forEach(r => {
          r.wordLink = "#";
        });
        alert(`已成功生成所有 ${newResults.length} 个方案的正式文档。`);
      }
      setDesignState(prev => ({ ...prev, results: newResults }));
      setIsGeneratingDocs(false);
    }, 1500);
  };

  const handleDownload = (type: 'EXCEL' | 'WORD' | 'PNG') => {
    alert(`正在导出并下载 ${type} 格式文件...`);
  };

  const closeHistoryPreview = () => setPreviewHistoryItem(null);

  const filteredEquipments = useMemo(() => {
    const query = equipmentSearchQuery.toLowerCase();
    return equipments.filter(e => 
      e.model.toLowerCase().includes(query) || 
      e.brand.toLowerCase().includes(query) || 
      e.category.toLowerCase().includes(query)
    );
  }, [equipments, equipmentSearchQuery]);

  const addEquipment = (eq: Equipment) => setEquipments(prev => [...prev, eq]);
  const updateEquipment = (eq: Equipment) => setEquipments(prev => prev.map(item => item.id === eq.id ? eq : item));
  const deleteEquipment = (id: string) => setEquipments(prev => prev.filter(item => item.id !== id));

  const updateHistory = (item: any) => setHistory(prev => prev.map(h => h.id === item.id ? item : h));
  const deleteHistory = (id: string) => setHistory(prev => prev.filter(h => h.id !== id));

  return {
    currentPage, setCurrentPage,
    currentSolutionTab, setCurrentSolutionTab,
    currentResultTab, setCurrentResultTab,
    isChatOpen, setIsChatOpen,
    chatInputValue, setChatInputValue,
    designState, setDesignState,
    isProcessingAi, isGeneratingDocs,
    editingItem, setEditingItem,
    previewHistoryItem, setPreviewHistoryItem,
    equipments: filteredEquipments, 
    equipmentSearchQuery, setEquipmentSearchQuery,
    history,
    handleParamChange, handleMicChange, addMic, removeMic,
    startDesign, handleSendMessage, deleteItem, saveEdit, handleGenerateReports,
    handleUpdateProjectName,
    handleDownload, closeHistoryPreview,
    addEquipment, updateEquipment, deleteEquipment,
    updateHistory, deleteHistory
  };
};
