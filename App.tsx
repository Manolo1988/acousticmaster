
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { 
  Scenario, Page, SolutionTab, ResultTab, MicConfig, DesignState, 
  ChatMessage, VerificationResultTab, EquipmentCategory, Equipment,
  AcousticParams
} from './types';
import { 
  MIC_TYPES, DEFAULT_PARAMS, SCENARIO_THEMES, VERIFY_THEME,
  MOCK_EQUIPMENTS, MOCK_HISTORY 
} from './constants';
import { processAcousticCommand } from './services/geminiService';
import Visualization from './components/Visualization';

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>(Page.SOLUTION);
  const [currentSolutionTab, setCurrentSolutionTab] = useState<SolutionTab>(SolutionTab.DESIGN);
  const [currentResultTab, setCurrentResultTab] = useState<ResultTab>(ResultTab.PLAN);
  const [verifyTab, setVerifyTab] = useState<VerificationResultTab>(VerificationResultTab.REPORT);
  const [managementTab, setManagementTab] = useState<'EQUIPMENT' | 'TEMPLATE'>('EQUIPMENT');
  const [equipFilter, setEquipFilter] = useState<EquipmentCategory | '全部'>('全部');

  const [designState, setDesignState] = useState<DesignState>({
    scenario: Scenario.MEETING_ROOM,
    params: DEFAULT_PARAMS,
    blueprint: null,
    isDesigned: false,
    chatHistory: [{ role: 'ai', text: '您好，我是您的声学助理。请描述您的场景需求（如：120平米会议室，需要矩阵和全向话筒），我会自动同步参数并优化方案。', timestamp: new Date() }]
  });

  const [aiInput, setAiInput] = useState("");
  const [isProcessingAi, setIsProcessingAi] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const theme = currentSolutionTab === SolutionTab.DESIGN ? SCENARIO_THEMES[designState.scenario] : VERIFY_THEME;

  const handleParamChange = (key: keyof AcousticParams | 'scenario', value: any) => {
    console.log(`[Param Change] ${key} ->`, value);
    if (key === 'scenario') {
      setDesignState(prev => ({ ...prev, scenario: value }));
      return;
    }
    setDesignState(prev => ({ ...prev, params: { ...prev.params, [key]: value } }));
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
    console.log("%c[Action] 点击开始设计按钮", "background: #6366f1; color: white; padding: 2px 4px; border-radius: 4px", {
      params: designState.params,
      extra: designState.params.extraRequirements
    });
    setIsProcessingAi(true);
    setTimeout(() => {
      setDesignState(prev => ({ 
        ...prev, 
        isDesigned: true,
        chatHistory: [...prev.chatHistory, {
          role: 'ai',
          text: '方案初步设计已完成。已根据房间尺寸和您的额外要求优化了音箱布局和声压分布。',
          timestamp: new Date()
        }]
      }));
      setIsProcessingAi(false);
      setCurrentResultTab(ResultTab.PLAN);
    }, 1200);
  };

  const handleAiSend = async () => {
    if (!aiInput.trim()) return;
    
    console.log("%c[Action] 发送对话指令", "background: #f59e0b; color: white; padding: 2px 4px; border-radius: 4px", aiInput);
    
    const userMsg: ChatMessage = { role: 'user', text: aiInput, timestamp: new Date() };
    setDesignState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, userMsg] }));
    const currentInput = aiInput;
    setAiInput("");
    setIsProcessingAi(true);

    const result = await processAcousticCommand(currentInput);
    if (result) {
      const aiMsg: ChatMessage = { role: 'ai', text: '需求已解析，参数已实时更新至左侧面板。', timestamp: new Date() };
      setDesignState(prev => ({
        ...prev,
        scenario: result.scenario === 'LECTURE_HALL' ? Scenario.LECTURE_HALL : Scenario.MEETING_ROOM,
        params: { 
          ...prev.params, 
          ...result, 
          mics: result.suggestedMics?.map((m: any, i: number) => ({ id: i.toString(), type: m.type, count: m.count })) || prev.params.mics 
        },
        chatHistory: [...prev.chatHistory, aiMsg]
      }));
    } else {
      setDesignState(prev => ({
        ...prev,
        chatHistory: [...prev.chatHistory, { role: 'ai', text: '抱歉，未能完全理解您的描述。您可以尝试补充具体尺寸或系统要求。', timestamp: new Date() }]
      }));
    }
    setIsProcessingAi(false);
  };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [designState.chatHistory]);

  return (
    <div className={`flex flex-col h-screen overflow-hidden transition-all duration-700 ${currentPage === Page.SOLUTION ? theme.bg : 'bg-slate-50'}`}>
      {/* 顶部导航 */}
      <header className="bg-white border-b h-16 px-8 flex items-center justify-between z-50">
        <div className="flex items-center space-x-12">
          <div className="text-xl font-black tracking-tighter uppercase text-slate-900">
            声学<span className="text-indigo-600">大师</span>
          </div>
          <nav className="flex space-x-10">
            {(Object.values(Page) as Page[]).map(p => (
              <button 
                key={p} 
                onClick={() => setCurrentPage(p)} 
                className={`text-[13px] font-bold tracking-widest transition-all ${currentPage === p ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-900'}`}
              >
                {p === Page.SOLUTION ? '方案中心' : p === Page.MANAGEMENT ? '资源管理' : '项目历史'}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center border border-slate-200 hover:border-indigo-400 transition-all cursor-pointer shadow-sm group">
            <svg className="w-6 h-6 text-slate-400 group-hover:text-indigo-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden">
        {currentPage === Page.SOLUTION ? (
          <>
            {/* 二级菜单 */}
            <div className="bg-white/80 backdrop-blur-md border-b border-slate-200 h-12 px-8 flex items-center space-x-10 z-40">
              <button 
                onClick={() => setCurrentSolutionTab(SolutionTab.DESIGN)} 
                className={`text-[12px] font-bold tracking-widest transition-all border-b-2 h-full px-2 ${currentSolutionTab === SolutionTab.DESIGN ? 'text-slate-900 border-indigo-500' : 'text-slate-400 border-transparent hover:text-slate-600'}`}
              >
                方案设计
              </button>
              <button 
                onClick={() => setCurrentSolutionTab(SolutionTab.VERIFICATION)} 
                className={`text-[12px] font-bold tracking-widest transition-all border-b-2 h-full px-2 ${currentSolutionTab === SolutionTab.VERIFICATION ? 'text-slate-900 border-emerald-500' : 'text-slate-400 border-transparent hover:text-slate-600'}`}
              >
                方案验证
              </button>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {currentSolutionTab === SolutionTab.DESIGN ? (
                <>
                  {/* 第1列：参数输入 (340px) */}
                  <div className={`w-[340px] border-r border-slate-200 overflow-y-auto p-6 flex flex-col space-y-6 scrollbar-hide bg-white z-30 shadow-sm`}>
                    <div className="bg-slate-100 p-1.5 rounded-2xl flex border border-slate-200">
                      <button 
                        onClick={() => handleParamChange('scenario', Scenario.MEETING_ROOM)} 
                        className={`flex-1 py-2.5 rounded-xl text-[11px] font-bold transition-all ${designState.scenario === Scenario.MEETING_ROOM ? 'bg-white text-blue-600 shadow-md' : 'text-slate-500 hover:bg-white/50'}`}
                      >
                        会议室
                      </button>
                      <button 
                        onClick={() => handleParamChange('scenario', Scenario.LECTURE_HALL)} 
                        className={`flex-1 py-2.5 rounded-xl text-[11px] font-bold transition-all ${designState.scenario === Scenario.LECTURE_HALL ? 'bg-white text-purple-600 shadow-md' : 'text-slate-500 hover:bg-white/50'}`}
                      >
                        报告厅
                      </button>
                    </div>

                    <div className="p-5 rounded-[2rem] space-y-5 bg-slate-50 border border-slate-100">
                      <h3 className={`text-[11px] font-bold uppercase tracking-widest text-slate-800`}>几何尺寸参数</h3>
                      <div className="grid grid-cols-2 gap-4">
                        {[{k:'length',l:'房间长度(米)'},{k:'width',l:'房间宽度(米)'},{k:'height',l:'音箱悬挂高度(米)'}].map(f => (
                          <div key={f.k} className={f.k === 'height' ? 'col-span-2' : ''}>
                            <label className="text-[10px] text-slate-500 font-bold mb-1.5 block">{f.l}</label>
                            <input 
                              type="number" 
                              value={(designState.params as any)[f.k]} 
                              onChange={e => handleParamChange(f.k as any, parseFloat(e.target.value))} 
                              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-[13px] text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all font-mono" 
                            />
                          </div>
                        ))}

                        {/* 报告厅特定参数 */}
                        {designState.scenario === Scenario.LECTURE_HALL && (
                          <div className="col-span-2 grid grid-cols-2 gap-4 pt-4 border-t border-slate-200 animate-in fade-in slide-in-from-top-2">
                             {[
                               {k:'stageToNearAudience', l:'台口至最近观众(m)'},
                               {k:'stageToFarAudience', l:'台口至最远观众(m)'},
                               {k:'stageWidth', l:'舞台台口宽度(m)'},
                               {k:'stageDepth', l:'舞台区域深度(m)'}
                             ].map(f => (
                               <div key={f.k}>
                                  <label className="text-[10px] text-slate-400 font-black mb-1.5 block uppercase">{f.l}</label>
                                  <input 
                                    type="number" 
                                    value={(designState.params as any)[f.k]} 
                                    onChange={e => handleParamChange(f.k as any, parseFloat(e.target.value))} 
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-[12px] text-indigo-600 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all font-mono" 
                                  />
                               </div>
                             ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="bg-slate-50 p-5 rounded-[2rem] border border-slate-100 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-[11px] font-bold tracking-widest text-indigo-600">话筒设备配置</h3>
                        <button onClick={addMic} className="text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-100 font-bold px-3 py-1.5 rounded-xl hover:bg-indigo-600 hover:text-white transition-all">+ 添加</button>
                      </div>
                      <div className="space-y-3">
                        {designState.params.mics.map(m => (
                          <div key={m.id} className="flex items-center space-x-3 bg-white p-3 rounded-2xl border border-slate-200 group shadow-sm">
                            <select 
                              value={m.type} 
                              onChange={e => {
                                const newMics = designState.params.mics.map(mic => mic.id === m.id ? {...mic, type: e.target.value} : mic);
                                handleParamChange('mics', newMics);
                              }} 
                              className="flex-1 bg-transparent text-[12px] text-slate-700 font-bold outline-none"
                            >
                              {MIC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <input 
                              type="number" 
                              value={m.count} 
                              onChange={e => handleMicChange(m.id, parseInt(e.target.value))} 
                              className="w-10 bg-slate-50 rounded-lg text-[12px] text-center font-bold text-slate-900 outline-none border border-slate-200 py-1" 
                            />
                            <button onClick={() => removeMic(m.id)} className="text-slate-300 hover:text-red-500 transition-colors">✕</button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-slate-50 p-5 rounded-[2rem] border border-slate-100 space-y-4">
                      <h3 className="text-[11px] font-bold tracking-widest text-slate-500">配套子系统</h3>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          {k:'hasCentralControl',l:'中控系统'},{k:'hasMatrix',l:'矩阵系统'},
                          {k:'hasVideoConf',l:'视频会议'},{k:'hasRecording',l:'录播系统'}
                        ].map(s => (
                          <label key={s.k} className="flex items-center p-3 rounded-2xl border border-slate-200 bg-white cursor-pointer hover:bg-indigo-50 transition-all group shadow-sm">
                            <input 
                              type="checkbox" 
                              checked={(designState.params as any)[s.k]} 
                              onChange={e => handleParamChange(s.k as any, e.target.checked)} 
                              className="w-4 h-4 rounded-lg bg-transparent border-slate-300 text-indigo-600 focus:ring-0" 
                            />
                            <span className="text-[11px] text-slate-600 ml-3 font-bold group-hover:text-indigo-600">{s.l}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* 新增：额外需求输入框 */}
                    <div className="bg-slate-50 p-5 rounded-[2rem] border border-slate-100 space-y-4">
                      <h3 className="text-[11px] font-bold tracking-widest text-slate-500 uppercase">额外需求描述</h3>
                      <textarea 
                        value={designState.params.extraRequirements}
                        onChange={e => handleParamChange('extraRequirements', e.target.value)}
                        placeholder="请输入特殊功能需求、设备品牌偏好或其它备注信息..."
                        className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-[12px] text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all min-h-[100px] resize-none scrollbar-hide font-medium leading-relaxed"
                      />
                    </div>

                    <div 
                      onClick={() => {
                        console.log("[Action] 点击图纸上传");
                        fileInputRef.current?.click();
                      }} 
                      className="bg-slate-50 border border-dashed border-slate-300 rounded-[2rem] p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 transition-all group"
                    >
                      <span className="text-[11px] text-slate-400 font-bold group-hover:text-indigo-400">点击上传CAD/现场图纸</span>
                      <input type="file" ref={fileInputRef} className="hidden" />
                    </div>

                    <button 
                      onClick={startDesign} 
                      className={`w-full py-5 ${theme.primary} text-white rounded-[2rem] font-black tracking-[0.2em] text-[13px] shadow-lg hover:brightness-105 active:scale-95 transition-all mt-auto`}
                    >
                      开始方案设计
                    </button>
                  </div>

                  {/* 第2列：需求沟通历史 (300px) */}
                  <div className={`w-[300px] border-r border-slate-200 flex flex-col bg-slate-50/40 backdrop-blur-sm z-20 shadow-inner`}>
                    <div className="p-5 border-b border-slate-100 bg-white/90 shadow-sm">
                      <h3 className="text-[12px] font-black tracking-widest text-slate-900">需求沟通纪要</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-hide">
                      {designState.chatHistory.map((msg, i) => (
                        <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                          <div className={`max-w-[95%] p-4 rounded-[1.5rem] text-[12px] leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white border border-slate-100 text-slate-700 rounded-bl-none'}`}>
                            {msg.text}
                          </div>
                          <span className="text-[10px] text-slate-400 mt-2 font-bold px-1 uppercase">{msg.timestamp.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                        </div>
                      ))}
                      <div ref={chatEndRef}></div>
                    </div>
                    <div className="p-4 bg-white border-t border-slate-100">
                      <div className="relative group">
                        <textarea 
                          value={aiInput} 
                          onChange={e => setAiInput(e.target.value)} 
                          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleAiSend())} 
                          placeholder="描述具体需求..." 
                          className="w-full bg-slate-50 border border-slate-200 rounded-[1.5rem] p-4 pr-12 text-[12px] text-slate-900 outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 resize-none h-24 scrollbar-hide transition-all shadow-inner" 
                        />
                        <button 
                          onClick={handleAiSend} 
                          disabled={isProcessingAi} 
                          className="absolute bottom-3 right-3 w-8 h-8 bg-indigo-600 text-white rounded-xl flex items-center justify-center hover:bg-indigo-700 transition-all shadow-md active:scale-90"
                        >
                          {isProcessingAi ? '...' : '→'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 第3列：工作台 (可视化图纸与结果汇总) */}
                  <div className="flex-1 flex flex-col overflow-hidden relative bg-white">
                    <div className="flex-1 overflow-y-auto p-10 space-y-10 scrollbar-hide">
                      <div className="flex justify-between items-end">
                        <div className="space-y-2">
                          <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase leading-none">
                            {designState.scenario === Scenario.MEETING_ROOM ? '会议室' : '报告厅'} 空间布局预览
                          </h2>
                          <p className="text-slate-400 text-[11px] font-bold tracking-[0.4em]">专业级声学拓扑与环境映射</p>
                        </div>
                        {designState.isDesigned && (
                          <div className="bg-indigo-50 border border-indigo-100 px-6 py-2.5 rounded-[1.5rem] text-[11px] font-black text-indigo-600 tracking-widest shadow-sm animate-in fade-in slide-in-from-right-4">设计分析已就绪</div>
                        )}
                      </div>

                      <div className="bg-slate-50 rounded-[4rem] border border-slate-200 h-[550px] shadow-inner overflow-hidden relative flex items-center justify-center group">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-50/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
                        <Visualization params={designState.params} scenario={designState.scenario} blueprint={designState.blueprint} />
                      </div>

                      {/* 参数汇总列表 */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-32">
                        <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm space-y-5 transition-all hover:shadow-md">
                          <h4 className={`text-[12px] font-black tracking-widest ${theme.text} border-b border-slate-50 pb-3`}>几何参数汇总</h4>
                          <div className="space-y-3">
                            {[
                              {l:'房间长度',v:designState.params.length+'米'},
                              {l:'房间宽度',v:designState.params.width+'米'},
                              {l:'音箱挂高',v:designState.params.height+'米'},
                              {l:'建筑面积',v:(designState.params.length*designState.params.width).toFixed(1)+'㎡'}
                            ].map(i => (
                              <div key={i.l} className="flex justify-between border-b border-slate-50 pb-2">
                                <span className="text-[11px] text-slate-400 font-bold">{i.l}</span>
                                <span className="text-[13px] font-black text-slate-900">{i.v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm space-y-5 transition-all hover:shadow-md">
                          <h4 className={`text-[12px] font-black tracking-widest ${theme.text} border-b border-slate-50 pb-3`}>话筒设备清单</h4>
                          <div className="space-y-3 max-h-[160px] overflow-y-auto scrollbar-hide">
                            {designState.params.mics.length > 0 ? designState.params.mics.map(m => (
                              <div key={m.id} className="flex justify-between items-center bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                <span className="text-[11px] font-bold text-slate-600">{m.type}</span>
                                <span className="text-[13px] font-black text-slate-900">x{m.count}</span>
                              </div>
                            )) : (
                              <div className="text-center py-6 text-slate-300 text-[11px] font-bold">暂无话筒配置</div>
                            )}
                          </div>
                        </div>
                        <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm space-y-5 transition-all hover:shadow-md">
                          <h4 className={`text-[12px] font-black tracking-widest ${theme.text} border-b border-slate-50 pb-3`}>集成子系统状态</h4>
                          <div className="flex flex-wrap gap-2.5">
                            {[
                              {k:'hasCentralControl',l:'中控系统'},{k:'hasMatrix',l:'矩阵切换'},
                              {k:'hasVideoConf',l:'视频会议'},{k:'hasRecording',l:'录播系统'}
                            ].map(s => (designState.params as any)[s.k] && (
                              <span key={s.k} className="px-4 py-2 bg-slate-100 rounded-2xl text-[10px] font-bold text-slate-700 border border-slate-200 shadow-sm">{s.l}</span>
                            ))}
                          </div>
                          {!Object.values(designState.params).some(v => v === true) && (
                            <div className="text-center py-6 text-slate-300 text-[11px] font-bold">无集成系统</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 第4列：垂直侧边栏菜单 (80px) */}
                  <div className="w-20 border-l border-slate-200 flex flex-col items-center py-12 space-y-12 bg-slate-50 z-20">
                    {[
                      {id:ResultTab.PLAN, l:'方案', i:'📋'},
                      {id:ResultTab.SIMULATION, l:'仿真', i:'📡'},
                      {id:ResultTab.REPORT, l:'报告', i:'📄'}
                    ].map(t => {
                      const isActive = currentResultTab === t.id;
                      const isDisabled = !designState.isDesigned && t.id !== ResultTab.PLAN;
                      return (
                        <button 
                          key={t.id} 
                          disabled={isDisabled} 
                          onClick={() => setCurrentResultTab(t.id)} 
                          className={`flex flex-col items-center group transition-all duration-300 ${isDisabled ? 'opacity-40 grayscale-0 cursor-not-allowed scale-90' : 'cursor-pointer hover:-translate-y-1'}`}
                        >
                          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-500 ${isActive ? 'bg-indigo-600 text-white scale-110 shadow-lg' : 'bg-white border border-slate-200 text-slate-400 group-hover:border-indigo-200'}`}>
                            <span className="text-2xl">{t.i}</span>
                          </div>
                          <span className={`text-[11px] font-black mt-4 tracking-tighter ${isActive ? 'text-slate-900' : 'text-slate-400'}`}>{t.l}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                /* 方案验证界面 */
                <div className="flex-1 flex overflow-hidden bg-slate-50">
                  <div className={`w-[360px] border-r border-slate-200 p-10 flex flex-col space-y-10 bg-white shadow-xl`}>
                    <div className="text-center space-y-3">
                      <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">核验实验室</h2>
                      <p className="text-[11px] text-emerald-600 font-bold tracking-widest">专业级声学审计工作站</p>
                    </div>
                    <div className="space-y-6">
                      <div onClick={() => setIsVerifying(true)} className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-[2rem] p-12 flex flex-col items-center justify-center cursor-pointer hover:bg-emerald-50 hover:border-emerald-200 transition-all group">
                        <span className="text-[12px] text-slate-400 font-bold group-hover:text-emerald-600">点击上传方案图纸</span>
                      </div>
                      <div onClick={() => setIsVerifying(true)} className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-[2rem] p-12 flex flex-col items-center justify-center cursor-pointer hover:bg-emerald-50 hover:border-emerald-200 transition-all group">
                        <span className="text-[12px] text-slate-400 font-bold group-hover:text-emerald-600">上传设备清单明细</span>
                      </div>
                    </div>
                    <button 
                      onClick={() => setIsVerifying(true)} 
                      className="w-full py-6 bg-emerald-600 text-white rounded-[2rem] font-black tracking-widest text-[13px] shadow-lg hover:bg-emerald-700 mt-auto transition-all active:scale-95"
                    >
                      启动自动核验流程
                    </button>
                  </div>
                  <div className="flex-1 p-12 overflow-y-auto scrollbar-hide">
                    {!isVerifying ? (
                      <div className="h-full flex flex-col items-center justify-center opacity-10">
                        <span className="text-[12rem] grayscale">🔬</span>
                        <p className="text-4xl font-black tracking-[1em] mt-10 text-slate-900">就绪中</p>
                      </div>
                    ) : (
                      <div className="bg-white rounded-[4rem] p-20 shadow-2xl border border-slate-100 max-w-5xl mx-auto animate-in fade-in duration-1000">
                        <div className="border-b-8 border-emerald-600 pb-10 mb-12 flex justify-between items-end">
                           <h2 className="text-6xl font-black text-slate-900">审计报告</h2>
                           <span className="text-slate-400 text-[12px] font-bold">编号: AC-{Date.now().toString(16).toUpperCase()}</span>
                        </div>
                        <div className="space-y-12">
                          <div className="bg-emerald-50 p-10 rounded-[2.5rem] border border-emerald-100 flex items-start shadow-inner">
                            <div className="w-16 h-16 bg-emerald-600 rounded-[1.5rem] flex items-center justify-center text-white text-4xl mr-8 shadow-md shrink-0 border-4 border-white">✓</div>
                            <div>
                               <h4 className="text-[14px] font-black text-emerald-800 mb-3">综合核验结论：合格</h4>
                               <p className="text-[16px] font-bold text-slate-700 leading-relaxed italic">
                                 "经仿真计算，该方案在语言清晰度（STI 0.72）与声压级均匀度（&plusmn;1.5dB）两项核心指标上均优于国家一级设计标准，满足各类高端商务会议需求。"
                               </p>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-10">
                             <div className="bg-slate-50 p-8 rounded-[2rem] border border-slate-200 shadow-sm">
                                <h5 className="text-[12px] font-black text-slate-400 mb-6 uppercase tracking-widest">核心声学指标分析</h5>
                                <div className="space-y-5">
                                   <div className="flex justify-between items-center text-sm font-bold border-b border-slate-200 pb-2"><span>STI 语言清晰度</span><span className="text-emerald-600">0.72 (优)</span></div>
                                   <div className="flex justify-between items-center text-sm font-bold border-b border-slate-200 pb-2"><span>扩声均匀度</span><span className="text-emerald-600">&plusmn;1.5dB</span></div>
                                   <div className="flex justify-between items-center text-sm font-bold border-b border-slate-200 pb-2"><span>背景噪声级别</span><span className="text-emerald-600">NR-25</span></div>
                                </div>
                             </div>
                             <div className="bg-slate-50 p-8 rounded-[2rem] border border-slate-200 shadow-sm">
                                <h5 className="text-[12px] font-black text-slate-400 mb-6 uppercase tracking-widest">硬件集成系统审计</h5>
                                <div className="space-y-5">
                                   <div className="flex justify-between items-center text-sm font-bold border-b border-slate-200 pb-2"><span>阻抗匹配校准</span><span className="text-emerald-600">已通过</span></div>
                                   <div className="flex justify-between items-center text-sm font-bold border-b border-slate-200 pb-2"><span>功放冗余系数</span><span className="text-emerald-600">1.25 (达标)</span></div>
                                   <div className="flex justify-between items-center text-sm font-bold border-b border-slate-200 pb-2"><span>Dante网络时延</span><span className="text-emerald-600">3.2毫秒</span></div>
                                </div>
                             </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : currentPage === Page.MANAGEMENT ? (
          /* 资源管理界面 */
          <div className="flex-1 flex overflow-hidden bg-slate-50">
            <div className="w-72 border-r bg-white p-10 flex flex-col space-y-5 shadow-sm z-10">
              <h2 className="text-[11px] font-black tracking-widest text-slate-400 mb-10">资源控制中心</h2>
              <button 
                onClick={() => setManagementTab('EQUIPMENT')} 
                className={`w-full py-5 px-8 rounded-[1.8rem] text-left text-[13px] font-bold transition-all duration-500 ${managementTab === 'EQUIPMENT' ? 'bg-slate-900 text-white shadow-xl scale-105' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-900'}`}
              >
                设备库管理
              </button>
              <button 
                onClick={() => setManagementTab('TEMPLATE')} 
                className={`w-full py-5 px-8 rounded-[1.8rem] text-left text-[13px] font-bold transition-all duration-500 ${managementTab === 'TEMPLATE' ? 'bg-slate-900 text-white shadow-xl scale-105' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-900'}`}
              >
                方案模板库
              </button>
            </div>
            <div className="flex-1 p-16 overflow-y-auto scrollbar-hide">
              <div className="max-w-7xl mx-auto">
                <div className="flex justify-between items-center mb-16">
                  <div className="space-y-3">
                    <h3 className="text-5xl font-black text-slate-900 tracking-tighter uppercase">
                      {managementTab === 'EQUIPMENT' ? '设备资源档案' : '标准设计模板'}
                    </h3>
                    <p className="text-slate-400 text-[12px] font-bold tracking-[0.6em]">核心数字化资产管理系统</p>
                  </div>
                  <button className="bg-slate-900 text-white px-10 py-4 rounded-[1.8rem] font-bold text-[13px] shadow-lg hover:bg-slate-800 transition-all">+ 新增资源</button>
                </div>
                {managementTab === 'EQUIPMENT' && (
                  <div className="bg-white rounded-[3.5rem] border border-slate-200 overflow-hidden shadow-xl animate-in fade-in duration-500">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-12 py-8 text-[11px] font-bold text-slate-400 tracking-widest">制造商 / 品牌</th>
                          <th className="px-12 py-8 text-[11px] font-bold text-slate-400 tracking-widest">型号 / 序列</th>
                          <th className="px-12 py-8 text-[11px] font-bold text-slate-400 tracking-widest text-right">资产类别</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {MOCK_EQUIPMENTS.map(e => (
                          <tr key={e.id} className="hover:bg-slate-50 transition-all duration-300">
                            <td className="px-12 py-10 text-lg font-black text-slate-900 tracking-tight uppercase">{e.brand}</td>
                            <td className="px-12 py-10 text-sm font-bold text-slate-500">{e.model}</td>
                            <td className="px-12 py-10 text-right"><span className="bg-slate-100 px-5 py-2 rounded-2xl text-[10px] font-bold text-slate-700 border border-slate-200 uppercase">{e.category}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* 项目历史界面 */
          <div className="flex-1 p-20 bg-slate-50 overflow-y-auto scrollbar-hide">
            <div className="max-w-6xl mx-auto space-y-20">
              <div className="flex justify-between items-end">
                <div className="space-y-4">
                  <h2 className="text-8xl font-black text-slate-900 tracking-tighter uppercase leading-none">历史档案</h2>
                  <p className="text-slate-400 text-[12px] font-black tracking-[1em] mt-8">项目数字化资产索引</p>
                </div>
                <div className="bg-white p-2.5 rounded-[2.5rem] flex border border-slate-200 shadow-xl">
                   <button className="px-12 py-5 bg-slate-900 text-white rounded-[2rem] text-[13px] font-bold shadow-md">全部档案</button>
                   <button className="px-12 py-5 text-slate-400 rounded-[2rem] text-[13px] font-bold hover:bg-slate-50 transition-all">我的收藏</button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-10 pb-40 animate-in fade-in duration-700">
                {MOCK_HISTORY.map(record => (
                  <div key={record.id} className="bg-white p-12 rounded-[4rem] border border-slate-100 shadow-sm flex items-center hover:shadow-2xl transition-all duration-500 group hover:translate-x-4">
                    <div className={`w-24 h-24 rounded-[2.5rem] flex items-center justify-center mr-12 text-5xl shadow-inner border border-slate-50 ${record.type === 'DESIGN' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                      {record.type === 'DESIGN' ? '📄' : '🔬'}
                    </div>
                    <div className="flex-1 space-y-4">
                      <div className="flex items-center space-x-6">
                        <h4 className="text-3xl font-black text-slate-900 tracking-tight">{record.name}</h4>
                        <span className={`text-[11px] font-bold px-4 py-1.5 rounded-full border shadow-sm ${record.status === '已完成' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>{record.status}</span>
                      </div>
                      <p className="text-[12px] text-slate-400 font-bold tracking-widest uppercase">{record.type === 'DESIGN' ? '声学设计方案集成' : '实验室审计核验报告'} · 日期: {record.date}</p>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-all duration-500 flex space-x-4">
                       <button className="px-8 py-3.5 bg-slate-900 text-white rounded-[1.5rem] text-[12px] font-bold shadow-md hover:bg-slate-800">查阅详情</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 底部状态栏 */}
      <footer className="h-10 bg-white border-t text-slate-400 flex items-center justify-between px-10 text-[10px] font-bold tracking-[0.5em] uppercase z-50 shadow-inner">
        <div className="flex space-x-12">
          <span className="flex items-center"><div className="w-2 h-2 rounded-full bg-green-500 mr-3 shadow-md"></div>核心服务: 运行中</span>
          <span>引擎版本: v4.6.0_AI_中文版</span>
        </div>
        <span>声学大师 © 2024 专业方案设计套件</span>
      </footer>
    </div>
  );
};

export default App;
