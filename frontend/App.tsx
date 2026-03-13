
import React, { useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Scenario, Page, SolutionTab, ResultTab, User, TableType, DbInventoryItem, HistoryRecord, EquipmentItem, AcousticParams } from './types';
import { MIC_TYPES, SCENARIO_THEMES, VERIFY_THEME } from './constants';
import Visualization from './components/Visualization';
import { useAcousticLogic } from './hooks/useAcousticLogic';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'lottie-player': any;
    }
  }
}

type ResultView = 'TABLE' | 'WORD';
const UI_SCALE = 1.5;

const App: React.FC = () => {
  const logic = useAcousticLogic();
  const [activeResultView, setActiveResultView] = useState<ResultView>('TABLE');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [editingEq, setEditingEq] = useState<DbInventoryItem | null>(null);
  const [isAddingEq, setIsAddingEq] = useState(false);
  const [editingHistory, setEditingHistory] = useState<HistoryRecord | null>(null);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);

  // 用户管理弹窗状态
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isAddingUser, setIsAddingUser] = useState(false);

  // 用户个人资料下拉框状态
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const [showReportDialog, setShowReportDialog] = useState(false);
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [exportDialogType, setExportDialogType] = useState<'EXCEL' | 'WORD' | null>(null);
  const [detailDialog, setDetailDialog] = useState<{ resIdx: number; itemIdx: number; item: EquipmentItem; detail: DbInventoryItem | null; table: TableType | null } | null>(null);
  const [replacementId, setReplacementId] = useState<number | ''>('');

  const [tempType, setTempType] = useState<TableType>(logic.activeTable);
  const activeResult = logic.designState.results[logic.designState.activeResultIndex];

  const theme = logic.currentSolutionTab === SolutionTab.VERIFICATION
    ? VERIFY_THEME
    : SCENARIO_THEMES[logic.designState.scenario];

  const themeText = `text-${theme.color}`;
  const themeBg = `bg-${theme.color}`;
  const themeBorder = `border-${theme.color}`;
  const isBlueprintLocked = !!logic.designState.blueprint;

  const getItemDetail = (item: EquipmentItem) => logic.getCachedEquipmentDetail(item);
  const getItemBrand = (item: EquipmentItem) => item.brand || getItemDetail(item)?.品牌 || '';
  const getItemUnitPrice = (item: EquipmentItem) => {
    const raw = item.unitPrice ?? getItemDetail(item)?.市场价;
    return raw ? Number(raw) : 0;
  };

  const activeTotalPrice = activeResult?.items.reduce((sum, item) => {
    return sum + getItemUnitPrice(item) * (item.quantity || 0);
  }, 0) || 0;

  const reportUpToDate = !!(activeResult?.lastReportSignature && activeResult.lastReportSignature === logic.buildItemsSignature(activeResult.items));
  const hasGeneratedReport = reportUpToDate || !!activeResult?.wordLink;
  const hasWordExport = reportUpToDate;
  const hasExcelExport = reportUpToDate;
  const wordPreviewUrl = activeResult?.wordLink?.startsWith('https://')
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(activeResult.wordLink)}`
    : '';
  const detailOptions = detailDialog?.table ? logic.getInventoryOptions(detailDialog.table) : [];

  const toggleSort = (key: string) => {
    logic.setSortConfig(prev => {
      if (!prev || prev.key !== key) {
        return { key, direction: 'asc' };
      }
      return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
    });
  };

  const renderSortArrow = (key: string) => {
    if (logic.sortConfig?.key !== key) {
      return <span className="ml-1 text-slate-300">▲▼</span>;
    }
    return (
      <span className="ml-1 text-slate-500">
        {logic.sortConfig.direction === 'asc' ? '▲' : '▼'}
      </span>
    );
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logic.designState.chatHistory, logic.isChatOpen]);

  // 当方案切换时，如果当前视图是方案预览且未生成，则切回到数据清单
  useEffect(() => {
    if (activeResultView === 'WORD' && !hasWordExport) {
      setActiveResultView('TABLE');
    }
  }, [logic.designState.activeResultIndex, hasWordExport]);

  useEffect(() => {
    if (!activeResult?.items?.length) return;
    activeResult.items.forEach(item => {
      logic.fetchEquipmentDetail(item);
    });
  }, [logic.designState.activeResultIndex, activeResult?.items]);

  // 处理点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const renderTopNav = () => (
    <header className="bg-white border-b h-11 px-5 flex items-center justify-between z-50 shrink-0 shadow-sm relative">
      <div className="flex items-center space-x-6">
        <div className="text-base font-black tracking-tighter uppercase text-slate-900">
          声学<span className={themeText}>大师</span>
        </div>
        <nav className="flex space-x-5 h-11">
          {(Object.values(Page) as Page[]).filter(p => {
            if (p === Page.MANAGEMENT || p === Page.USERS) {
              return logic.currentUser.role === '管理员';
            }
            return true;
          }).map(p => (
            <button key={p} onClick={() => logic.setCurrentPage(p)}
              className={`text-[11px] font-bold h-full relative px-1 transition-all flex items-center ${logic.currentPage === p ? `${themeText} border-b-2 ${themeBorder}` : 'text-slate-400 hover:text-slate-900'}`}>
              {p === Page.SOLUTION ? '方案设计' : p === Page.VERIFICATION ? '方案验证' : p === Page.MANAGEMENT ? '资源管理' : p === Page.HISTORY ? '历史设计' : '用户管理'}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center space-x-4">
        {/* 系统 AI 状态控制 */}
        <div className="flex items-center space-x-2 mr-4 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">AI 引擎</span>
          <div className="flex items-center">
            <span className={`w-2 h-2 rounded-full mr-2 ${logic.isAiBackendRunning ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500'}`}></span>
            <button 
              onClick={() => logic.toggleAiBackend(logic.isAiBackendRunning ? 'stop' : 'start')}
              className={`text-[10px] font-bold py-0.5 px-2 rounded transition-all ${
                logic.isAiBackendRunning 
                  ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' 
                  : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
              }`}
            >
              {logic.isAiBackendRunning ? '关闭' : '开启'}
            </button>
          </div>
        </div>

        {/* 用户头像与下拉菜单 */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setIsProfileOpen(!isProfileOpen)}
            className={`flex items-center space-x-2 group p-0.5 pr-2 rounded-full border transition-all ${isProfileOpen ? 'bg-slate-50 border-slate-200' : 'border-transparent hover:bg-slate-50'}`}
          >
            <div className={`w-7 h-7 rounded-full ${themeBg} text-white flex items-center justify-center font-black text-[10px] shadow-sm relative`}>
              {logic.currentUser.username[0]}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white"></span>
            </div>
            <span className="text-[11px] font-bold text-slate-600 group-hover:text-slate-900">{logic.currentUser.username}</span>
            <svg className={`w-3 h-3 text-slate-300 transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"></path></svg>
          </button>

          {/* 下拉菜单 */}
          {isProfileOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200">
              {/* 用户信息头部 */}
              <div className="p-4 bg-slate-50/80 border-b border-slate-100">
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 rounded-full ${themeBg} text-white flex items-center justify-center font-black text-xs shadow-lg`}>
                    {logic.currentUser.username[0]}
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-900">{logic.currentUser.username}</div>
                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{logic.currentUser.role}</div>
                    <div className="text-[10px] text-slate-400 mt-1 truncate max-w-[140px]">{logic.currentUser.phone || '未填写电话'}</div>
                  </div>
                </div>
              </div>

              {/* 菜单列表 */}
              <div className="p-2 space-y-1">
                <button onClick={() => { setIsProfileOpen(false); setIsProfileDialogOpen(true); }} className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                  <span>个人资料</span>
                </button>
                <button className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                  <span>账户设置</span>
                </button>
                <div className="h-px bg-slate-100 mx-2 my-1"></div>
                <button className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <span>帮助中心</span>
                </button>
              </div>

              {/* 退出登录按钮 */}
              <div className="p-2 border-t border-slate-100 bg-slate-50/50">
                {logic.currentUser.isGuest ? (
                  <button
                    onClick={() => { setIsProfileOpen(false); setIsLoginOpen(true); }}
                    className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-[11px] font-black text-blue-600 hover:bg-blue-50 transition-all uppercase tracking-widest"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                    <span>登录系统</span>
                  </button>
                ) : (
                  <button
                    onClick={() => { setIsProfileOpen(false); logic.handleLogout(); }}
                    className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-[11px] font-black text-red-500 hover:bg-red-50 transition-all uppercase tracking-widest"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                    <span>退出登录</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );

  const renderSolutionSidebar = () => (
    <div className={`w-[290px] ${theme.lightBg} border-r border-slate-200 flex flex-col shrink-0`}>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col space-y-3 scrollbar-hide">
        <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 space-y-2">
          <div className="flex items-center justify-between border-b pb-1">
            <h3 className={`text-[10px] font-black ${themeText} uppercase tracking-widest`}>项目名称</h3>
            <span className="text-[9px] font-bold text-slate-400">用于导出文档</span>
          </div>
          <input
            type="text"
            value={logic.designState.projectName}
            onChange={e => logic.handleUpdateProjectName(e.target.value)}
            placeholder="请输入项目名称..."
            className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-2 text-[12px] font-bold ${themeText} outline-none focus:bg-white focus:ring-1 focus:ring-opacity-20 ring-${theme.color}`}
          />
        </div>

        <div className={isBlueprintLocked ? 'pointer-events-none opacity-60' : ''}>
          <div className="bg-slate-200/40 p-0.5 rounded-lg flex border border-slate-200 shadow-inner">
            <button
              onClick={() => logic.handleParamChange('scenario', Scenario.MEETING_ROOM)}
              className={`flex-1 py-1 rounded-md text-[11px] font-bold transition-all ${logic.designState.scenario === Scenario.MEETING_ROOM ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
            >
              会议室
            </button>
            <button
              onClick={() => logic.handleParamChange('scenario', Scenario.LECTURE_HALL)}
              className={`flex-1 py-1 rounded-md text-[11px] font-bold transition-all ${logic.designState.scenario === Scenario.LECTURE_HALL ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500'}`}
            >
              报告厅
            </button>
          </div>
          <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 space-y-2 mt-3">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-1">物理参数 (M)</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-slate-400 font-bold mb-0.5 block">房间长</label>
                <input type="number" value={logic.designState.params.length} onChange={e => logic.handleParamChange('length', parseFloat(e.target.value))} className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-1 text-[12px] font-bold ${themeText} outline-none focus:bg-white focus:ring-1 focus:ring-opacity-20 ring-${theme.color}`} />
              </div>
              <div>
                <label className="text-[9px] text-slate-400 font-bold mb-0.5 block">房间宽</label>
                <input type="number" value={logic.designState.params.width} onChange={e => logic.handleParamChange('width', parseFloat(e.target.value))} className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-1 text-[12px] font-bold ${themeText} outline-none focus:bg-white focus:ring-1 focus:ring-opacity-20 ring-${theme.color}`} />
              </div>
              <div className="col-span-2">
                <label className="text-[9px] text-slate-400 font-bold mb-0.5 block">安装高度</label>
                <input type="number" value={logic.designState.params.height} onChange={e => logic.handleParamChange('height', parseFloat(e.target.value))} className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-1 text-[12px] font-bold ${themeText} outline-none focus:bg-white focus:ring-1 focus:ring-opacity-20 ring-${theme.color}`} />
              </div>

              {logic.designState.scenario === Scenario.LECTURE_HALL && (
                <div className="col-span-2 grid grid-cols-2 gap-2 pt-1 border-t border-slate-50">
                  <div>
                    <label className="text-[9px] text-slate-400 font-bold mb-0.5 block leading-tight">台口至最近</label>
                    <input type="number" value={logic.designState.params.stageToNearAudience} onChange={e => logic.handleParamChange('stageToNearAudience', parseFloat(e.target.value))} className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-1 text-[12px] font-bold outline-none ${themeText}`} />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-400 font-bold mb-0.5 block leading-tight">台口至最远</label>
                    <input type="number" value={logic.designState.params.stageToFarAudience} onChange={e => logic.handleParamChange('stageToFarAudience', parseFloat(e.target.value))} className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-1 text-[12px] font-bold outline-none ${themeText}`} />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-400 font-bold mb-0.5 block leading-tight">台口宽度</label>
                    <input type="number" value={logic.designState.params.stageWidth} onChange={e => logic.handleParamChange('stageWidth', parseFloat(e.target.value))} className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-1 text-[12px] font-bold outline-none ${themeText}`} />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-400 font-bold mb-0.5 block leading-tight">舞台深度</label>
                    <input type="number" value={logic.designState.params.stageDepth} onChange={e => logic.handleParamChange('stageDepth', parseFloat(e.target.value))} className={`w-full bg-slate-50 border border-slate-100 rounded px-2 py-1 text-[12px] font-bold outline-none ${themeText}`} />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 space-y-2 mt-3">
            <div className="flex items-center justify-between border-b pb-1">
              <h3 className={`text-[10px] font-black ${themeText} uppercase tracking-widest`}>话筒配置</h3>
              <button onClick={logic.addMic} className={`text-[8px] font-black px-1.5 py-0.5 rounded border ${themeText} ${themeBorder} bg-slate-50 hover:bg-white transition-colors`}>+ 添加</button>
            </div>
            <div className="space-y-1.5">
              {logic.designState.params.mics.map(m => (
                <div key={m.id} className="flex items-center space-x-1.5 group">
                  <select value={m.type} onChange={e => logic.handleParamChange('mics', logic.designState.params.mics.map(mic => mic.id === m.id ? { ...mic, type: e.target.value } : mic))} className="flex-1 bg-slate-50 border border-slate-100 rounded px-1.5 py-1 text-[11px] font-bold outline-none">
                    {MIC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input type="number" value={m.count} onChange={e => logic.handleMicChange(m.id, parseInt(e.target.value))} className={`w-8 bg-white border border-slate-200 rounded py-1 text-center text-[11px] font-bold ${themeText} outline-none`} />
                  <button onClick={() => logic.removeMic(m.id)} className="text-slate-300 hover:text-red-500 text-[9px] px-0.5">✕</button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 space-y-2 mt-3">
            <h3 className="text-[10px] font-black text-slate-400 border-b pb-1 uppercase tracking-widest">配套子系统</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'hasCentralControl', l: '中控' }, { id: 'hasMatrix', l: '矩阵' }, { id: 'hasVideoConf', l: '视频' }, { id: 'hasRecording', l: '录播' }
              ].map(sys => (
                <label key={sys.id} className="flex items-center space-x-1.5 bg-slate-50/50 p-1.5 rounded border border-slate-100 cursor-pointer hover:bg-white transition-all">
                  <input type="checkbox" checked={(logic.designState.params as any)[sys.id]} onChange={e => logic.handleParamChange(sys.id as any, e.target.checked)} className={`w-3 h-3 rounded accent-${theme.color.split('-')[0]}`} />
                  <span className="text-[10px] font-bold text-slate-600">{sys.l}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 space-y-1.5 flex-1 mt-3">
            <h3 className="text-[10px] font-black text-slate-400 border-b pb-1 uppercase tracking-widest">其他需求</h3>
            <textarea
              value={logic.designState.params.extraRequirements}
              onChange={e => logic.handleParamChange('extraRequirements', e.target.value)}
              placeholder="补充品牌偏好等..."
              className="w-full bg-slate-50 border border-slate-100 rounded px-2 py-1.5 text-[11px] font-medium outline-none h-14 resize-none focus:bg-white transition-all"
            />
          </div>
        </div>

        <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 space-y-2">
          <h3 className="text-[10px] font-black text-slate-400 border-b pb-1 uppercase tracking-widest">环境图纸</h3>
          <label className="flex flex-col items-center justify-center w-full h-12 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-all">
            <div className="flex flex-col items-center justify-center">
              <svg className="w-4 h-4 text-slate-400 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
              <p className="text-[8px] text-slate-500 font-bold uppercase">上传 CAD 图纸 (JPG/PNG)</p>
            </div>
            <input type="file" className="hidden" accept="image/*" onChange={logic.handleBlueprintUpload} />
          </label>
        </div>
      </div>
      <div className="p-3 pt-0">
        <button onClick={logic.startDesign} disabled={logic.isProcessingAi} className={`w-full py-2.5 ${themeBg} text-white rounded-lg font-bold text-[13px] shadow-lg hover:brightness-110 transition-all shrink-0 uppercase tracking-widest`}>
          {logic.isProcessingAi ? '生成中...' : '启动方案设计'}
        </button>
      </div>
    </div>
  );

  const renderSolutionView = () => (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      {!logic.designState.isDesigned ? (
        isBlueprintLocked ? (
          <div className="flex-1 flex flex-col p-5 overflow-hidden">
            <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl shadow-inner relative overflow-hidden">
              {logic.designState.blueprint && (
                <img
                  src={logic.designState.blueprint}
                  alt="CAD 预览"
                  className={`absolute inset-0 w-full h-full object-contain transition-all ${logic.isProcessingAi ? 'grayscale opacity-40' : 'opacity-90'}`}
                />
              )}
              {logic.isProcessingAi && (
                <div className="absolute inset-0 bg-white/70 flex flex-col items-center justify-center">
                  <div className="flex flex-col items-center justify-center">
                    <lottie-player
                      src="https://assets2.lottiefiles.com/packages/lf20_qm8eqzse.json"
                      background="transparent"
                      speed="1"
                      style={{ width: '320px', height: '320px' }}
                      loop
                      autoplay
                    ></lottie-player>
                    <div className="text-[18px] text-slate-700 font-semibold mt-2">正在为您定制音频方案...</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : logic.isProcessingAi ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <div className="flex flex-col items-center justify-center">
              <lottie-player
                src="https://assets2.lottiefiles.com/packages/lf20_qm8eqzse.json"
                background="transparent"
                speed="1"
                style={{ width: '320px', height: '320px' }}
                loop
                autoplay
              ></lottie-player>
              <div className="text-[18px] text-slate-700 font-semibold mt-2">正在为您定制音频方案...</div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 opacity-10">
            <div className="text-7xl mb-6">📐</div>
            <h2 className="text-lg font-black uppercase tracking-[0.4em] text-center">输入参数开启智能设计方案</h2>
          </div>
        )
      ) : (
        <div className="flex-1 flex flex-col p-5 space-y-4 overflow-y-auto scrollbar-hide">
          <div className="flex justify-between items-center border-b pb-3 shrink-0">
            <div className="flex items-center space-x-3">
              <div className="flex items-baseline space-x-2">
                <h2 className="text-xl font-black text-slate-900 tracking-tighter uppercase leading-none shrink-0">设计看板</h2>
                <div className="flex items-center group relative cursor-pointer" onClick={() => setIsEditingProjectName(true)}>
                  {isEditingProjectName ? (
                    <input
                      autoFocus
                      type="text"
                      value={logic.designState.projectName}
                      onBlur={() => setIsEditingProjectName(false)}
                      onKeyDown={e => { if (e.key === 'Enter') setIsEditingProjectName(false); }}
                      onChange={e => logic.handleUpdateProjectName(e.target.value)}
                      className="text-[10px] font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded outline-none border border-slate-200"
                    />
                  ) : (
                    <>
                      <span className="text-slate-500 text-[10px] font-bold tracking-tight bg-slate-50 px-2 py-0.5 rounded border border-transparent group-hover:border-slate-200 transition-all">
                        {logic.designState.projectName}
                      </span>
                      <svg className="w-3 h-3 ml-1 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                {/* 动态导出按钮逻辑 */}
                {logic.currentResultTab === ResultTab.PLAN ? (
                  <>
                    {(hasExcelExport || hasWordExport) && (
                      <div className="flex items-center space-x-2 animate-in fade-in slide-in-from-right-2 duration-300">
                        {hasExcelExport && (
                          <button
                            onClick={() => {
                              if (logic.designState.results.length > 1) {
                                setExportDialogType('EXCEL');
                              } else {
                                logic.handleDownload('EXCEL', 'CURRENT');
                              }
                            }}
                            className="flex items-center space-x-2 px-3 h-8 rounded-md font-bold text-[9px] uppercase border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
                          >
                            <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                            <span>导出清单 (Excel)</span>
                          </button>
                        )}
                        {hasWordExport && (
                          <button
                            onClick={() => {
                              if (logic.designState.results.length > 1) {
                                setExportDialogType('WORD');
                              } else {
                                logic.handleDownload('WORD', 'CURRENT');
                              }
                            }}
                            className="flex items-center space-x-2 px-3 h-8 rounded-md font-bold text-[9px] uppercase border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
                          >
                            <svg className="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                            <span>导出方案 (Word)</span>
                          </button>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => setShowReportDialog(true)}
                      disabled={logic.isGeneratingDocs || reportUpToDate || !activeResult}
                      className={`flex items-center space-x-2 px-4 h-8 rounded-md font-black text-[10px] uppercase transition-all shadow-md active:scale-95 ${logic.isGeneratingDocs || reportUpToDate || !activeResult ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : `${themeBg} text-white hover:brightness-110`}`}
                    >
                      {logic.isGeneratingDocs ? (
                        <>
                          <div className="w-3 h-3 border-2 border-slate-300 border-t-white rounded-full animate-spin"></div>
                          <span>生成中...</span>
                        </>
                      ) : reportUpToDate ? (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
                          <span>报告已生成</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                          <span>生成正式报告</span>
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => logic.handleDownload('PNG')}
                    className="flex items-center space-x-2 px-4 h-8 rounded-md font-black text-[10px] uppercase border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm active:scale-95 transition-all animate-in fade-in slide-in-from-right-2 duration-300"
                  >
                    <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                    <span>下载仿真图 (PNG)</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3 flex-1 flex flex-col">
            <div className="flex justify-between items-center shrink-0">
              <div className="flex flex-col space-y-1">
                <div className="flex space-x-1">
                  {logic.designState.results.map((res, idx) => (
                    <button
                      key={res.id}
                      onClick={() => { logic.setDesignState(prev => ({ ...prev, activeResultIndex: idx })); }}
                      className={`px-3 py-1.5 rounded-md text-[10px] font-black transition-all ${logic.designState.activeResultIndex === idx ? `bg-slate-900 text-white shadow-md` : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
                    >
                      {res.title}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest py-1">
                  总价：<span className="text-slate-900">¥{activeTotalPrice.toLocaleString()}</span>
                </div>
              </div>
              <div className="bg-slate-50 p-0.5 rounded-md border border-slate-200 flex items-center h-8">
                {/* 切换放置在每个方案之下，体现它是针对当前方案的属性 */}
                <button onClick={() => logic.setCurrentResultTab(ResultTab.PLAN)} className={`px-3 h-7 rounded-sm text-[10px] font-bold transition-all ${logic.currentResultTab === ResultTab.PLAN ? `bg-white ${themeText} shadow-sm` : 'text-slate-400'}`}>方案明细</button>
                <button onClick={() => logic.setCurrentResultTab(ResultTab.SIMULATION)} className={`px-3 h-7 rounded-sm text-[10px] font-bold transition-all ${logic.currentResultTab === ResultTab.SIMULATION ? `bg-white ${themeText} shadow-sm` : 'text-slate-400'}`}>声学仿真</button>
              </div>
            </div>

            {logic.currentResultTab === ResultTab.PLAN ? (
              <div className="flex-1 flex flex-col space-y-3">
                <div className="flex justify-end">
                  <div className="bg-slate-100/50 p-0.5 rounded-md border border-slate-200 flex items-center h-8">
                    <button onClick={() => setActiveResultView('TABLE')} className={`px-3 h-7 rounded-sm text-[10px] font-bold transition-all ${activeResultView === 'TABLE' ? `bg-white ${themeText} shadow-sm` : 'text-slate-400'}`}>数据清单</button>
                    {/* 方案预览仅在生成后显示 */}
                    {hasWordExport && (
                      <button onClick={() => setActiveResultView('WORD')} className={`px-3 h-7 rounded-sm text-[10px] font-bold transition-all animate-in zoom-in-95 duration-200 ${activeResultView === 'WORD' ? `bg-white ${themeText} shadow-sm` : 'text-slate-400'}`}>方案预览</button>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col relative flex-1">
                  {activeResultView === 'TABLE' ? (
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead className="sticky top-0 bg-slate-50 z-10 border-b">
                          <tr>
                            <th className="px-5 py-2.5 font-bold text-slate-400 uppercase tracking-tighter">设备分类</th>
                            <th className="px-5 py-2.5 font-bold text-slate-400 uppercase tracking-tighter">品牌</th>
                            <th className="px-5 py-2.5 font-bold text-slate-400 uppercase tracking-tighter">产品名称</th>
                            <th className="px-5 py-2.5 font-bold text-slate-400 uppercase tracking-tighter">型号规格</th>
                            <th className="px-5 py-2.5 font-bold text-slate-400 uppercase tracking-tighter text-center">数量</th>
                            <th className="px-5 py-2.5 font-bold text-slate-400 uppercase tracking-tighter text-right">单价</th>
                            <th className="px-5 py-2.5 text-right pr-5 font-bold text-slate-400 uppercase tracking-tighter">管理操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {activeResult?.items.map((item, idx) => (
                            <tr key={item.id} className="hover:bg-slate-50/50 transition-all group">
                              <td className="px-5 py-2.5 text-slate-500 font-medium">{item.type}</td>
                              <td className="px-5 py-2.5 text-slate-600 font-bold">{getItemBrand(item) || '--'}</td>
                              <td className="px-5 py-2.5 font-bold text-slate-900">{item.name}</td>
                              <td className="px-5 py-2.5 text-slate-400 font-mono text-[10px]">{item.model}</td>
                              <td className={`px-5 py-2.5 font-black text-center ${themeText}`}>{item.quantity}</td>
                              <td className="px-5 py-2.5 text-right font-black text-slate-700">¥{getItemUnitPrice(item).toLocaleString()}</td>
                              <td className="px-5 py-2.5 text-right space-x-3 pr-5">
                                <button
                                  onClick={async () => {
                                    const table = Object.values(TableType).includes(item.type as TableType)
                                      ? (item.type as TableType)
                                      : item.type === '功放'
                                        ? TableType.AMPLIFIER
                                        : item.type === '线阵列配套'
                                          ? TableType.LINE_ARRAY
                                          : item.type === '周边设备'
                                            ? TableType.PERIPHERAL
                                            : item.type === '其他设备'
                                              ? TableType.OTHER
                                              : null;

                                    if (table) {
                                      await logic.ensureInventoryOptions(table);
                                    }

                                    const detail = await logic.fetchEquipmentDetail(item);
                                    setDetailDialog({ resIdx: logic.designState.activeResultIndex, itemIdx: idx, item: { ...item }, detail, table });
                                    setReplacementId(detail?.id || '');
                                  }}
                                  className="text-slate-500 font-bold hover:underline"
                                >
                                  详细
                                </button>
                                <button onClick={() => logic.setEditingItem({ resIdx: logic.designState.activeResultIndex, itemIdx: idx, item: { ...item } })} className={`${themeText} font-bold hover:underline`}>编辑</button>
                                <button onClick={() => logic.deleteItem(logic.designState.activeResultIndex, idx)} className="text-slate-300 hover:text-red-500 font-bold">删除</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="flex-1 p-6 overflow-y-auto bg-slate-50/30">
                      <div className="max-w-5xl mx-auto bg-white shadow-xl border border-slate-100 rounded-lg p-6 space-y-4 animate-in fade-in zoom-in-95 duration-300">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                          <h1 className="text-lg font-black text-slate-900 tracking-tight uppercase">声学系统设计方案 - {activeResult?.title}</h1>
                          {activeResult?.wordLink && (
                            <a
                              className={`text-[10px] font-black uppercase ${themeText} hover:underline`}
                              href={activeResult.wordLink}
                              target="_blank"
                              rel="noreferrer"
                            >
                              打开原始 Word
                            </a>
                          )}
                        </div>
                        {activeResult?.wordLink && wordPreviewUrl ? (
                          <div className="w-full aspect-[1/1.41] bg-slate-50 border border-slate-200 rounded overflow-hidden">
                            <iframe
                              title="word-preview"
                              className="w-full h-full"
                              src={wordPreviewUrl}
                            />
                          </div>
                        ) : activeResult?.wordLink ? (
                          <div className="aspect-[1/1.41] bg-slate-50 border border-dashed border-slate-200 rounded flex flex-col items-center justify-center text-slate-400 font-bold text-[12px] uppercase tracking-[0.3em] space-y-4">
                            <div className="text-slate-500">预览不可用（仅支持 https 链接）</div>
                            <a
                              className={`text-[10px] font-black uppercase ${themeText} hover:underline`}
                              href={activeResult.wordLink}
                              target="_blank"
                              rel="noreferrer"
                            >
                              点击打开 Word
                            </a>
                          </div>
                        ) : (
                          <div className="aspect-[1/1.41] bg-slate-50 border border-dashed border-slate-200 rounded flex flex-col items-center justify-center text-slate-300 font-black text-[12px] uppercase tracking-[0.5em] space-y-4">
                            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-200">
                              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                            </div>
                            <span>未获取到 Word 文档</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden relative shadow-inner min-h-[350px]">
                {/* 每个方案传入自己的 items */}
                <Visualization
                  params={logic.designState.params}
                  scenario={logic.designState.scenario}
                  blueprint={logic.designState.blueprint}
                  items={activeResult?.items}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 生成文档选择对话框 */}
      {showReportDialog && (
        <div className="fixed inset-0 z-[300] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-5">
          <div className="bg-white w-full max-sm rounded-2xl shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">生成正式报告</h3>
              <button onClick={() => setShowReportDialog(false)} className="text-slate-300 hover:text-slate-900 transition-colors">✕</button>
            </div>
            <p className="text-[11px] text-slate-500 font-medium">请选择需要转换成正式方案文档的范围：</p>
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => { logic.handleGenerateReports('CURRENT'); setShowReportDialog(false); }}
                className="flex flex-col items-start p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-blue-400 hover:shadow-md transition-all group"
              >
                <span className="text-[11px] font-black text-slate-900 group-hover:text-blue-600">方案：{activeResult?.title} (仅当前)</span>
                <span className="text-[9px] text-slate-400 mt-1">仅针对当前选中的推荐方案生成正式文档并开启预览/下载。</span>
              </button>
              <button
                onClick={() => { logic.handleGenerateReports('ALL'); setShowReportDialog(false); }}
                className="flex flex-col items-start p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-blue-400 hover:shadow-md transition-all group"
              >
                <span className="text-[11px] font-black text-slate-900 group-hover:text-blue-600">所有推荐方案 (共 {logic.designState.results.length} 个)</span>
                <span className="text-[9px] text-slate-400 mt-1">对本次设计出的所有备选方案同时生成正式文档并开启预览/下载。</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {exportDialogType && (
        <div className="fixed inset-0 z-[310] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-5">
          <div className="bg-white w-full max-sm rounded-2xl shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                {exportDialogType === 'EXCEL' ? '导出清单 (Excel)' : '导出方案 (Word)'}
              </h3>
              <button onClick={() => setExportDialogType(null)} className="text-slate-300 hover:text-slate-900 transition-colors">✕</button>
            </div>
            <p className="text-[11px] text-slate-500 font-medium">请选择导出范围：</p>
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => { logic.handleDownload(exportDialogType, 'CURRENT'); setExportDialogType(null); }}
                className="flex flex-col items-start p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-blue-400 hover:shadow-md transition-all group"
              >
                <span className="text-[11px] font-black text-slate-900 group-hover:text-blue-600">仅当前方案：{activeResult?.title}</span>
                <span className="text-[9px] text-slate-400 mt-1">只导出当前选中方案。</span>
              </button>
              <button
                onClick={() => { logic.handleDownload(exportDialogType, 'ALL'); setExportDialogType(null); }}
                className="flex flex-col items-start p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-blue-400 hover:shadow-md transition-all group"
              >
                <span className="text-[11px] font-black text-slate-900 group-hover:text-blue-600">全部方案 (共 {logic.designState.results.length} 个)</span>
                <span className="text-[9px] text-slate-400 mt-1">同时导出所有方案。</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // App.tsx 内部 renderManagementView 修改
  // App.tsx 内部 renderManagementView 函数
  const renderManagementView = () => (
    <div className="flex-1 flex overflow-hidden bg-white">
      {/* 左侧设备目录 (对应 image_557afb) */}
      <div className="w-56 bg-slate-50 border-r border-slate-200 flex flex-col p-4 shrink-0">
        <h2 className="text-xs font-black text-slate-900 uppercase tracking-widest mb-6 px-2">设备目录</h2>
        <nav className="space-y-1">
          {Object.values(TableType).map((t) => (
            <button key={t} onClick={() => logic.setActiveTable(t)}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-[11px] font-bold transition-all ${logic.activeTable === t ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-100'
                }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {/* 右侧列表 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-16 px-6 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-900">{logic.activeTable} 列表</h2>
          <button onClick={() => setIsAddingEq(true)} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest">+ 录入数据</button>
        </div>

        <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center gap-3">
          <input
            value={logic.searchFilters.品牌}
            onChange={e => logic.setSearchFilters(prev => ({ ...prev, 品牌: e.target.value }))}
            placeholder="筛选品牌"
            className="w-40 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] font-bold outline-none"
          />
          <input
            value={logic.searchFilters.产品名称}
            onChange={e => logic.setSearchFilters(prev => ({ ...prev, 产品名称: e.target.value }))}
            placeholder="筛选名称"
            className="w-48 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] font-bold outline-none"
          />
          <select
            value={logic.searchFilters.场景}
            onChange={e => logic.setSearchFilters(prev => ({ ...prev, 场景: e.target.value }))}
            className="w-36 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] font-bold outline-none"
          >
            <option value="">场景：全部</option>
            <option value="通用">通用</option>
            <option value="会议室">会议室</option>
            <option value="报告厅">报告厅</option>
          </select>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-white border-b">
              <tr>
                <th className="px-6 py-4 font-black text-slate-400">
                  <button onClick={() => toggleSort('品牌')} className="flex items-center">
                    品牌{renderSortArrow('品牌')}
                  </button>
                </th>
                <th className="px-6 py-4 font-black text-slate-400">产品名称</th>
                <th className="px-6 py-4 font-black text-slate-400">型号</th>
                <th className="px-6 py-4 font-black text-slate-400">
                  <button onClick={() => toggleSort('市场价')} className="flex items-center">
                    市场价{renderSortArrow('市场价')}
                  </button>
                </th>
                {logic.activeTable === TableType.SPEAKER ? (
                  <>
                    <th className="px-6 py-4 font-black text-slate-400">额定功率</th>
                    <th className="px-6 py-4 font-black text-slate-400">
                      <button onClick={() => toggleSort('最大声压级')} className="flex items-center">
                        最大声压级{renderSortArrow('最大声压级')}
                      </button>
                    </th>
                  </>
                ) : (
                  <>
                    <th className="px-6 py-4 font-black text-slate-400">描述</th>
                    <th className="px-6 py-4 font-black text-slate-400">场景</th>
                  </>
                )}
                <th className="px-6 py-4 text-right pr-6">管理</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {logic.inventory.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4 font-bold">{item.品牌}</td>
                  <td className="px-6 py-4">{item.产品名称}</td>
                  <td className="px-6 py-4 font-mono text-slate-400">{item.型号}</td>
                  <td className="px-6 py-4 font-black text-slate-900">¥{item.市场价}</td>
                  {logic.activeTable === TableType.SPEAKER ? (
                    <>
                      <td className="px-6 py-4">{item.额定功率}</td>
                      <td className="px-6 py-4">{item.最大声压级}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-4 truncate max-w-[150px]">{item.描述}</td>
                      <td className="px-6 py-4">{item.场景}</td>
                    </>
                  )}
                  <td className="px-6 py-4 text-right pr-6 space-x-2">
                    <button onClick={() => setEditingEq(item)} className="text-blue-600 font-bold">编辑</button>
                    <button
                      onClick={() => {
                        if (window.confirm('确定要删除该设备吗？')) {
                          logic.deleteInventoryItem(logic.activeTable, item.id);
                        }
                      }}
                      className="text-red-400 font-bold"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
  const renderHistoryView = () => (
    <div className="flex-1 flex flex-col p-6 overflow-y-auto bg-white">
      <div className="mb-8">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase">历史设计档案</h2>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">回顾及重新载入之前的设计成果</p>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">项目名称</th>
              <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">设计时间</th>
              <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">场景类型</th>
              <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">状态</th>
              <th className="px-6 py-4 text-right pr-6 font-black text-slate-400 uppercase tracking-widest">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logic.history.map(h => (
              <tr key={h.id} className="hover:bg-slate-50 transition-colors group">
                <td className="px-6 py-4 font-black text-slate-900">{h.projectName}</td>
                <td className="px-6 py-4 text-slate-400 font-mono">{new Date(h.createdAt).toISOString().slice(0, 10)}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${h.scenario === Scenario.MEETING_ROOM ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
                    }`}>{h.scenario === Scenario.MEETING_ROOM ? '会议室' : '报告厅'}</span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center space-x-1.5">
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                    <span className="text-emerald-600 font-bold">已完成</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-right pr-6 space-x-4">
                  <button onClick={() => logic.setPreviewHistoryItem(h)} className="text-blue-600 font-black hover:underline uppercase tracking-widest text-[9px]">详情预览</button>
                  <button onClick={() => setEditingHistory(h)} className="text-slate-500 font-black hover:underline uppercase tracking-widest text-[9px]">编辑</button>
                  <button onClick={() => logic.deleteHistoryRecord(h.id)} className="text-red-400 font-black hover:text-red-600 transition-colors uppercase tracking-widest text-[9px]">删除</button>
                </td>
              </tr>
            ))}
            {logic.history.length === 0 && (
              <tr>
                <td colSpan={5} className="py-20 text-center text-slate-300 font-black uppercase italic">暂无历史设计记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderHistoryPreview = () => {
    const item = logic.previewHistoryItem!;
    const scenarioLabel = item.scenario === Scenario.MEETING_ROOM ? '会议室' : '报告厅';
    const params: AcousticParams = item.params || {
      length: 0,
      width: 0,
      height: 0,
      stageToNearAudience: 0,
      stageToFarAudience: 0,
      stageWidth: 0,
      stageDepth: 0,
      mics: [],
      hasCentralControl: false,
      hasMatrix: false,
      hasVideoConf: false,
      hasRecording: false,
      micHandheld: 0,
      micGooseneck: 0,
      micOmni: 0,
      micLavalier: 0,
      micCeiling: 0,
      extraRequirements: ''
    };
    const historyResults = Array.isArray(item.results) ? item.results : [];
    const handleHistoryDownload = (type: 'EXCEL' | 'WORD') => {
      const missing: string[] = [];
      historyResults.forEach(res => {
        const link = type === 'WORD' ? res.wordLink : res.excelLink;
        if (link) {
          window.open(link, '_blank');
        } else {
          missing.push(res.title);
        }
      });
      if (missing.length) {
        alert(`${type === 'WORD' ? 'Word' : 'Excel'} 链接缺失：${missing.join('，')}`);
      }
    };
    return (
      <div className="fixed inset-0 z-[500] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-6">
        <div className="bg-white w-full max-w-5xl max-h-[90vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight uppercase">{item.projectName}</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">设计归档于 {new Date(item.createdAt).toISOString().slice(0, 10)}</p>
            </div>
            <button onClick={logic.closeHistoryPreview} className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">

        <div className="flex items-center space-x-3 mb-6">
          <button
            onClick={() => handleHistoryDownload('EXCEL')}
            className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-black uppercase"
          >
            下载清单 (Excel)
          </button>
          <button
            onClick={() => handleHistoryDownload('WORD')}
            className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-black uppercase"
          >
            下载方案 (Word)
          </button>
        </div>

        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 mb-6">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">设计参数</div>
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
              <span className="text-slate-400 font-bold">场景</span>
              <span className="font-black text-slate-900">{scenarioLabel}</span>
            </div>
            <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
              <span className="text-slate-400 font-bold">房间长</span>
              <span className="font-black text-slate-900">{params.length} m</span>
            </div>
            <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
              <span className="text-slate-400 font-bold">房间宽</span>
              <span className="font-black text-slate-900">{params.width} m</span>
            </div>
            <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
              <span className="text-slate-400 font-bold">安装高度</span>
              <span className="font-black text-slate-900">{params.height} m</span>
            </div>
            {item.scenario === Scenario.LECTURE_HALL && (
              <>
                <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
                  <span className="text-slate-400 font-bold">台口至最近</span>
                  <span className="font-black text-slate-900">{params.stageToNearAudience} m</span>
                </div>
                <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
                  <span className="text-slate-400 font-bold">台口至最远</span>
                  <span className="font-black text-slate-900">{params.stageToFarAudience} m</span>
                </div>
                <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
                  <span className="text-slate-400 font-bold">台口宽度</span>
                  <span className="font-black text-slate-900">{params.stageWidth} m</span>
                </div>
                <div className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
                  <span className="text-slate-400 font-bold">舞台深度</span>
                  <span className="font-black text-slate-900">{params.stageDepth} m</span>
                </div>
              </>
            )}
          </div>
          <div className="mt-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">话筒配置</div>
          <div className="grid grid-cols-2 gap-3 mt-2 text-[11px]">
            {(params.mics || []).map(mic => (
              <div key={mic.id} className="flex items-center justify-between bg-white border border-slate-100 rounded-lg px-3 py-2">
                <span className="text-slate-500 font-bold">{mic.type}</span>
                <span className="font-black text-slate-900">{mic.count} 套</span>
              </div>
            ))}
          </div>
          <div className="mt-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">配套子系统</div>
          <div className="flex flex-wrap gap-2 mt-2 text-[10px]">
            {params.hasCentralControl && <span className="px-2 py-1 rounded-full bg-white border border-slate-200 font-bold">中控</span>}
            {params.hasMatrix && <span className="px-2 py-1 rounded-full bg-white border border-slate-200 font-bold">矩阵</span>}
            {params.hasVideoConf && <span className="px-2 py-1 rounded-full bg-white border border-slate-200 font-bold">视频</span>}
            {params.hasRecording && <span className="px-2 py-1 rounded-full bg-white border border-slate-200 font-bold">录播</span>}
            {!params.hasCentralControl && !params.hasMatrix && !params.hasVideoConf && !params.hasRecording && (
              <span className="text-slate-400 font-bold">无</span>
            )}
          </div>
          {params.extraRequirements && (
            <div className="mt-4">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">其他需求</div>
              <div className="mt-2 text-[11px] text-slate-600 font-medium bg-white border border-slate-100 rounded-lg px-3 py-2">
                {params.extraRequirements}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">方案清单</div>
          {historyResults.map(res => (
            <div key={res.id} className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div className="text-[12px] font-black text-slate-900">{res.title}</div>
                <div className="text-[10px] text-slate-400">设备数量：{res.items.reduce((sum, it) => sum + (it.quantity || 0), 0)}</div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                {res.items.map(it => (
                  <div key={it.id} className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                    <span className="text-slate-600 font-bold">{it.name}</span>
                    <span className="font-black text-slate-900">x{it.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            logic.setDesignState(prev => ({
              ...prev,
              projectName: `${item.projectName}_复件`,
              scenario: item.scenario,
              params: item.params,
              results: item.results,
              isDesigned: true
            }));
            logic.setCurrentPage(Page.SOLUTION);
            logic.setPreviewHistoryItem(null);
          }}
          className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[11px] uppercase tracking-widest mt-6"
        >
          重新载入此设计
        </button>
          </div>
        </div>
      </div>
    );
  };

  const renderUserManagementView = () => {
    const keyword = logic.userNameFilter.trim().toLowerCase();
    const filteredUsers = logic.users.filter(u => {
      const roleMatch = logic.userRoleFilter === 'ALL' || u.role === logic.userRoleFilter;
      const keywordMatch = !keyword || u.username.toLowerCase().includes(keyword) || u.phone.includes(keyword);
      return roleMatch && keywordMatch;
    });

    return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden bg-white">
      <div className="shrink-0 mb-6">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase">用户管理中心</h2>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">管理系统成员权限、账户状态及安全策略</p>
      </div>

      {/* 过滤器 */}
      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-6 flex flex-wrap items-end gap-4 shrink-0">
        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">按角色过滤</label>
          <select
            value={logic.userRoleFilter}
            onChange={e => logic.setUserRoleFilter(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-[12px] font-bold outline-none"
          >
            <option value="ALL">所有角色</option>
            <option value="管理员">管理员</option>
            <option value="普通用户">普通用户</option>
          </select>
        </div>
        <div className="space-y-1.5 flex-[2] min-w-[300px]">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">搜索用户名或电话</label>
          <div className="relative">
            <input
              type="text"
              placeholder="请输入关键词..."
              value={logic.userNameFilter}
              onChange={e => logic.setUserNameFilter(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 pl-10 text-[12px] font-bold outline-none focus:ring-2 focus:ring-blue-500/10"
            />
            <svg className="w-4 h-4 absolute left-3.5 top-2.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </div>
        </div>
        <button
          onClick={() => setIsAddingUser(true)}
          className="bg-slate-900 text-white px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95"
        >
          + 新增成员
        </button>
      </div>

      {/* 用户列表表格 */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col">
        <div className="flex-1 overflow-auto scrollbar-hide">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-slate-50 border-b z-10">
              <tr>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">用户名</th>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">联系电话</th>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">公司</th>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">角色权限</th>
                <th className="px-6 py-4 text-right pr-6 font-black text-slate-400 uppercase tracking-widest w-40">管理操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map(u => (
                <tr key={u.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 rounded-full ${themeBg} text-white flex items-center justify-center font-black text-[10px]`}>{u.username[0]}</div>
                      <div>
                        <div className="font-black text-slate-900 text-[12px]">{u.username}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-500">{u.phone}</td>
                  <td className="px-6 py-4 text-slate-500">{u.company}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter border ${u.role === '管理员' ? 'border-red-200 bg-red-50 text-red-600' : 'border-blue-200 bg-blue-50 text-blue-600'}`}>{u.role}</span>
                  </td>
                  <td className="px-6 py-4 text-right pr-6 space-x-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setEditingUser(u)} className="text-blue-600 font-black hover:underline uppercase tracking-widest text-[9px]">编辑</button>
                    <button onClick={() => logic.deleteUser(u.id)} className="text-red-400 font-black hover:text-red-600 transition-colors uppercase tracking-widest text-[9px]">删除</button>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-20 text-center text-slate-300 font-black uppercase italic">未发现相关用户信息</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 用户编辑/新增弹窗 */}
      {(editingUser || isAddingUser) && (
        <div className="fixed inset-0 z-[500] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-5">
          <div className="bg-white w-full max-md rounded-3xl shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                {isAddingUser ? '新增平台成员' : `编辑用户资料：${editingUser?.username}`}
              </h3>
              <button onClick={() => { setEditingUser(null); setIsAddingUser(false); }} className="text-slate-300 hover:text-slate-900 transition-colors">✕</button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">用户名</label>
                <input id="user-name" defaultValue={isAddingUser ? "" : editingUser?.username} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="如：admin" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">联系电话</label>
                <input id="user-phone" defaultValue={isAddingUser ? "" : editingUser?.phone} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="如：13700000000" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">角色权限</label>
                  <select id="user-role" defaultValue={isAddingUser ? '普通用户' : editingUser?.role} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none">
                    <option value="管理员">管理员</option>
                    <option value="普通用户">普通用户</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">公司名称</label>
                  <input id="user-company" defaultValue={isAddingUser ? "" : editingUser?.company} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="如：中国计量大学" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">登录密码</label>
                <input id="user-password" type="password" defaultValue="" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="仅新增或修改时填写" />
              </div>
            </div>

            <div className="flex space-x-3 pt-4">
              <button onClick={() => { setEditingUser(null); setIsAddingUser(false); }} className="flex-1 py-3.5 rounded-2xl border border-slate-200 text-slate-400 font-black text-[11px] uppercase tracking-widest hover:bg-slate-50 transition-all">取消</button>
              <button onClick={() => {
                const username = (document.getElementById('user-name') as HTMLInputElement).value;
                const phone = (document.getElementById('user-phone') as HTMLInputElement).value;
                const company = (document.getElementById('user-company') as HTMLInputElement).value;
                const role = (document.getElementById('user-role') as HTMLSelectElement).value as any;
                const password = (document.getElementById('user-password') as HTMLInputElement).value;

                if (isAddingUser) {
                  logic.addUser({ username, phone, company, role, password });
                } else if (editingUser) {
                  logic.updateUser({ ...editingUser, username, phone, company, role, ...(password ? { password } : {}) });
                }
                setEditingUser(null); setIsAddingUser(false);
              }} className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[11px] uppercase shadow-xl hover:bg-black transition-all">保存设置</button>
            </div>
          </div>
        </div>
      )}
    </div>
    );
  };

  return (
    <div className={`${theme.lightBg} h-screen overflow-auto text-slate-900 font-sans`}>
      <div
        className="flex flex-col min-h-screen"
        style={{
          transform: `scale(${UI_SCALE})`,
          transformOrigin: 'top left',
          width: `${100 / UI_SCALE}%`,
          minHeight: `${100 / UI_SCALE}vh`
        }}
      >
      {renderTopNav()}
      <main className="flex-1 flex overflow-hidden">
        {logic.currentPage === Page.SOLUTION && (
          <>
            {renderSolutionSidebar()}
            {renderSolutionView()}
          </>
        )}
        {logic.currentPage === Page.MANAGEMENT && renderManagementView()}
        {logic.currentPage === Page.HISTORY && renderHistoryView()}
        {logic.currentPage === Page.USERS && renderUserManagementView()}
      </main>

      {logic.previewHistoryItem && renderHistoryPreview()}

      {/* --- 核心修改：动态录入弹窗 (基于 TableType 切换字段) --- */}
      {isAddingEq && (
        <div className="fixed inset-0 z-[600] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-5">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            {/* 头部：标题与关闭 */}
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                录入新设备
              </h3>
              <button onClick={() => setIsAddingEq(false)} className="text-slate-300 hover:text-slate-900 transition-colors text-xl font-black">✕</button>
            </div>

            <div className="space-y-6">
              {/* 第一步：选择设备类型 - 这是核心控制点 */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-blue-600 uppercase ml-1">第一步：选择设备大类</label>
                <select
                  value={tempType}
                  onChange={(e) => setTempType(e.target.value as TableType)}
                  className="w-full bg-blue-50/50 border border-blue-100 rounded-xl px-4 py-3 text-[13px] font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  {Object.values(TableType).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* 第二步：填写详细参数 - 根据 tempType 动态变化 */}
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-1">第二步：填写设备属性</label>
                <div className="grid grid-cols-2 gap-4">
                  {/* 无论什么类型都有的通用基础项 */}
                  <input id="new-brand" placeholder="品牌 (必填)" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
                  <input id="new-name" placeholder="产品名称 (必填)" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
                  <input id="new-model" placeholder="型号" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
                  <input id="new-price" type="number" placeholder="市场价 (¥)" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />

                  {/* --- 动态字段渲染逻辑 --- */}
                  {tempType === TableType.SPEAKER ? (
                    <>
                      {/* 音箱特有项 */}
                      <input id="new-res" placeholder="额定阻抗" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none" />
                      <input id="new-pwr" placeholder="额定功率" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none" />
                      <input id="new-sens" placeholder="灵敏度" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none" />
                      <input id="new-spl" placeholder="最大声压级" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none" />
                      <input id="new-cov" placeholder="覆盖角" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none" />
                      <input id="new-usage" placeholder="主要用途" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none" />
                    </>
                  ) : (
                    <>
                      {/* 其他设备特有项 */}
                      <input id="new-type" placeholder="具体子类型 (如：数字音频处理器)" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none" />
                      <select id="new-scene" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none">
                        <option value="通用">适用场景：通用</option>
                        <option value="会议室">适用场景：会议室</option>
                        <option value="报告厅">适用场景：报告厅</option>
                      </select>
                      <textarea id="new-desc" placeholder="请输入详细描述或备注信息..." className="col-span-2 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[12px] h-24 resize-none outline-none focus:bg-white" />
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="flex space-x-3 pt-4 border-t">
              <button onClick={() => setIsAddingEq(false)} className="flex-1 py-3.5 rounded-2xl border text-slate-400 font-black text-[11px] uppercase tracking-widest hover:bg-slate-50 transition-all">取消</button>
              <button
                onClick={() => {
                  const payload = {
                    类型: tempType,
                    品牌: (document.getElementById('new-brand') as HTMLInputElement).value,
                    产品名称: (document.getElementById('new-name') as HTMLInputElement).value,
                    型号: (document.getElementById('new-model') as HTMLInputElement).value,
                    市场价: parseFloat((document.getElementById('new-price') as HTMLInputElement).value) || 0,
                    // 根据当前 tempType 收集对应的特定字段
                    ...(tempType === TableType.SPEAKER ? {
                      额定功率: (document.getElementById('new-pwr') as HTMLInputElement).value,
                      最大声压级: (document.getElementById('new-spl') as HTMLInputElement).value,
                    } : {
                      描述: (document.getElementById('new-desc') as HTMLTextAreaElement).value,
                      场景: (document.getElementById('new-scene') as HTMLSelectElement).value,
                    })
                  };
                  logic.handleSaveEquipment(tempType, payload);
                  setIsAddingEq(false);
                }}
                className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[11px] uppercase shadow-xl hover:bg-black transition-all"
              >
                确认保存
              </button>
            </div>
          </div>
        </div>
      )}

      {editingEq && (
        <div className="fixed inset-0 z-[650] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-5">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">编辑设备</h3>
              <button onClick={() => setEditingEq(null)} className="text-slate-300 hover:text-slate-900 transition-colors text-xl font-black">✕</button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input id="edit-brand" defaultValue={editingEq.品牌} placeholder="品牌" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
                <input id="edit-name" defaultValue={editingEq.产品名称} placeholder="产品名称" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
                <input id="edit-model" defaultValue={editingEq.型号} placeholder="型号" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
                <input id="edit-price" defaultValue={editingEq.市场价} type="number" placeholder="市场价" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />

                {logic.activeTable === TableType.SPEAKER ? (
                  <>
                    <input id="edit-res" defaultValue={editingEq.额定阻抗} placeholder="额定阻抗" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none" />
                    <input id="edit-pwr" defaultValue={editingEq.额定功率} placeholder="额定功率" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none" />
                    <input id="edit-sens" defaultValue={editingEq.灵敏度} placeholder="灵敏度" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none" />
                    <input id="edit-spl" defaultValue={editingEq.最大声压级} placeholder="最大声压级" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none" />
                    <input id="edit-cov" defaultValue={editingEq.覆盖角} placeholder="覆盖角" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none" />
                    <input id="edit-usage" defaultValue={editingEq.用途} placeholder="主要用途" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none" />
                  </>
                ) : (
                  <>
                    <input id="edit-type" defaultValue={editingEq.类型} placeholder="具体子类型" className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] outline-none" />
                    <select id="edit-scene" defaultValue={editingEq.场景 || '通用'} className="w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none">
                      <option value="通用">适用场景：通用</option>
                      <option value="会议室">适用场景：会议室</option>
                      <option value="报告厅">适用场景：报告厅</option>
                    </select>
                    <textarea id="edit-desc" defaultValue={editingEq.描述} placeholder="请输入详细描述或备注信息..." className="col-span-2 w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[12px] h-24 resize-none outline-none focus:bg-white" />
                  </>
                )}
              </div>
            </div>

            <div className="flex space-x-3 pt-4 border-t">
              <button onClick={() => setEditingEq(null)} className="flex-1 py-3.5 rounded-2xl border text-slate-400 font-black text-[11px] uppercase tracking-widest hover:bg-slate-50 transition-all">取消</button>
              <button
                onClick={() => {
                  const payload = {
                    品牌: (document.getElementById('edit-brand') as HTMLInputElement).value,
                    产品名称: (document.getElementById('edit-name') as HTMLInputElement).value,
                    型号: (document.getElementById('edit-model') as HTMLInputElement).value,
                    市场价: parseFloat((document.getElementById('edit-price') as HTMLInputElement).value) || 0,
                    ...(logic.activeTable === TableType.SPEAKER ? {
                      额定阻抗: (document.getElementById('edit-res') as HTMLInputElement).value,
                      额定功率: (document.getElementById('edit-pwr') as HTMLInputElement).value,
                      灵敏度: (document.getElementById('edit-sens') as HTMLInputElement).value,
                      最大声压级: (document.getElementById('edit-spl') as HTMLInputElement).value,
                      覆盖角: (document.getElementById('edit-cov') as HTMLInputElement).value,
                      用途: (document.getElementById('edit-usage') as HTMLInputElement).value,
                    } : {
                      类型: (document.getElementById('edit-type') as HTMLInputElement).value,
                      场景: (document.getElementById('edit-scene') as HTMLSelectElement).value,
                      描述: (document.getElementById('edit-desc') as HTMLTextAreaElement).value,
                    })
                  };
                  logic.updateInventoryItem(logic.activeTable, editingEq.id, payload);
                  setEditingEq(null);
                }}
                className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[11px] uppercase shadow-xl hover:bg-black transition-all"
              >
                保存更新
              </button>
            </div>
          </div>
        </div>
      )}

      {editingHistory && (
        <div className="fixed inset-0 z-[655] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-5">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">编辑历史设计</h3>
              <button onClick={() => setEditingHistory(null)} className="text-slate-300 hover:text-slate-900 transition-colors text-xl font-black">✕</button>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">设计名称</label>
                <input id="history-name" defaultValue={editingHistory.projectName} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">场景类型</label>
                <select id="history-scenario" defaultValue={editingHistory.scenario} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none">
                  <option value={Scenario.MEETING_ROOM}>会议室</option>
                  <option value={Scenario.LECTURE_HALL}>报告厅</option>
                </select>
              </div>
            </div>
            <div className="flex space-x-3 pt-4 border-t">
              <button onClick={() => setEditingHistory(null)} className="flex-1 py-3.5 rounded-2xl border text-slate-400 font-black text-[11px] uppercase tracking-widest hover:bg-slate-50 transition-all">取消</button>
              <button
                onClick={() => {
                  const projectName = (document.getElementById('history-name') as HTMLInputElement).value;
                  const scenario = (document.getElementById('history-scenario') as HTMLSelectElement).value as Scenario;
                  logic.updateHistoryRecord(editingHistory.id, { projectName, scenario });
                  setEditingHistory(null);
                }}
                className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[11px] uppercase shadow-xl hover:bg-black transition-all"
              >
                保存修改
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoginOpen && (
        <div className="fixed inset-0 z-[660] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-5">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">登录系统</h3>
              <button onClick={() => setIsLoginOpen(false)} className="text-slate-300 hover:text-slate-900 transition-colors text-xl font-black">✕</button>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">用户名</label>
                <input id="login-username" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="请输入用户名" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">密码</label>
                <input id="login-password" type="password" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="请输入密码" />
              </div>
            </div>
            <div className="flex space-x-3 pt-4 border-t">
              <button onClick={() => setIsLoginOpen(false)} className="flex-1 py-3.5 rounded-2xl border text-slate-400 font-black text-[11px] uppercase tracking-widest hover:bg-slate-50 transition-all">取消</button>
              <button
                onClick={async () => {
                  const username = (document.getElementById('login-username') as HTMLInputElement).value.trim();
                  const password = (document.getElementById('login-password') as HTMLInputElement).value;
                  const ok = await logic.login(username, password);
                  if (!ok) {
                    alert('登录失败，请检查用户名或密码。');
                    return;
                  }
                  setIsLoginOpen(false);
                }}
                className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[11px] uppercase shadow-xl hover:bg-black transition-all"
              >
                立即登录
              </button>
            </div>
          </div>
        </div>
      )}

      {isProfileDialogOpen && (
        <div className="fixed inset-0 z-[670] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-5">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">个人资料</h3>
              <button onClick={() => setIsProfileDialogOpen(false)} className="text-slate-300 hover:text-slate-900 transition-colors text-xl font-black">✕</button>
            </div>
            {logic.currentUser.isGuest ? (
              <div className="space-y-4">
                <p className="text-[12px] text-slate-500">当前为游客身份，请先登录后查看或修改个人资料。</p>
                <button
                  onClick={() => { setIsProfileDialogOpen(false); setIsLoginOpen(true); }}
                  className="w-full py-3 bg-slate-900 text-white rounded-xl font-black text-[11px] uppercase"
                >
                  去登录
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">用户名</label>
                  <input id="profile-username" defaultValue={logic.currentUser.username} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">联系电话</label>
                  <input id="profile-phone" defaultValue={logic.currentUser.phone} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">公司名称</label>
                  <input id="profile-company" defaultValue={logic.currentUser.company} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">修改密码</label>
                  <input id="profile-password" type="password" defaultValue="" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="留空则不修改" />
                </div>
                <div className="flex space-x-3 pt-2">
                  <button onClick={() => setIsProfileDialogOpen(false)} className="flex-1 py-3.5 rounded-2xl border text-slate-400 font-black text-[11px] uppercase tracking-widest hover:bg-slate-50 transition-all">取消</button>
                  <button
                    onClick={async () => {
                      const username = (document.getElementById('profile-username') as HTMLInputElement).value;
                      const phone = (document.getElementById('profile-phone') as HTMLInputElement).value;
                      const company = (document.getElementById('profile-company') as HTMLInputElement).value;
                      const password = (document.getElementById('profile-password') as HTMLInputElement).value;
                      const ok = await logic.updateProfile({ username, phone, company, ...(password ? { password } : {}) });
                      if (!ok) {
                        alert('更新失败，请检查后端日志。');
                        return;
                      }
                      setIsProfileDialogOpen(false);
                    }}
                    className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[11px] uppercase shadow-xl hover:bg-black transition-all"
                  >
                    保存资料
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="fixed bottom-6 right-6 z-[200]">
        {!logic.isChatOpen ? (
          <button
            onClick={() => logic.setIsChatOpen(true)}
            className={`w-14 h-14 rounded-full ${themeBg} text-white shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all group`}
          >
            <svg className="w-6 h-6 group-hover:rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
          </button>
        ) : (
          <div className="w-[380px] h-[520px] bg-white rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300">
            <div className={`p-4 ${themeBg} text-white flex items-center justify-between`}>
              <h4 className="text-xs font-black uppercase tracking-widest">声学助理 AI</h4>
              <button onClick={() => logic.setIsChatOpen(false)} className="text-white/60 hover:text-white transition-colors">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 scrollbar-hide">
              {logic.designState.chatHistory.map((chat, idx) => (
                <div key={idx} className={`flex ${chat.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[90%] p-3.5 rounded-2xl text-[12px] leading-relaxed shadow-sm ${chat.role === 'user'
                    ? `${themeBg} text-white rounded-tr-none`
                    : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none prose prose-slate prose-xs max-w-none'
                    }`}>
                    {chat.role === 'user' ? (
                      chat.text
                    ) : chat.text.includes("AI 引擎当前处于关闭状态") ? (
                      <div className="space-y-3">
                        <p className="font-bold text-rose-600 mb-1">{chat.text}</p>
                        <button
                          onClick={async () => {
                            await logic.toggleAiBackend('start');
                            // 额外检查一次状态
                          }}
                          className={`${themeBg} text-white px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center space-x-2`}
                        >
                          <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                          <span>立即尝试开启 AI 引擎</span>
                        </button>
                      </div>
                    ) : (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          table: ({ node, ...props }) => (
                            <div className="overflow-x-auto my-2">
                              <table className="min-w-full border shadow-sm rounded-lg text-[10px]" {...props} />
                            </div>
                          ),
                          th: ({ node, ...props }) => <th className="border px-2 py-1 bg-slate-50 font-black text-slate-900" {...props} />,
                          td: ({ node, ...props }) => <td className="border px-2 py-1" {...props} />,
                          code: ({ node, ...props }) => <code className="bg-slate-100 px-1 rounded text-pink-600 font-mono" {...props} />,
                          p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
                        }}
                      >
                        {chat.text}
                      </ReactMarkdown>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="p-4 bg-white border-t border-slate-100 flex items-center space-x-2">
              <input
                type="text"
                value={logic.chatInputValue}
                onChange={e => logic.setChatInputValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && logic.handleSendMessage()}
                placeholder="描述您的需求..."
                className="flex-1 bg-slate-100 border-none rounded-full px-4 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button onClick={logic.handleSendMessage} className={`w-8 h-8 rounded-full flex items-center justify-center ${themeBg} text-white`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 12h14M12 5l7 7-7 7"></path></svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Editing Item Dialog */}
      {logic.editingItem && (
        <div className="fixed inset-0 z-[400] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white w-full max-md rounded-3xl shadow-2xl overflow-hidden">
            <div className={`px-6 py-4 ${themeBg} text-white flex items-center justify-between`}>
              <h3 className="text-sm font-black uppercase tracking-widest">编辑设备属性</h3>
              <button onClick={() => logic.setEditingItem(null)} className="text-white/60 hover:text-white transition-colors">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <input type="text" value={logic.editingItem.item.name} onChange={e => logic.setEditingItem({ ...logic.editingItem!, item: { ...logic.editingItem!.item, name: e.target.value } })} className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2.5 text-xs font-bold outline-none" />
              <input type="number" value={logic.editingItem.item.quantity} onChange={e => logic.setEditingItem({ ...logic.editingItem!, item: { ...logic.editingItem!.item, quantity: parseInt(e.target.value) || 0 } })} className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2.5 text-xs font-bold outline-none" />
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex space-x-3">
              <button onClick={() => logic.setEditingItem(null)} className="flex-1 py-3 rounded-xl border border-slate-200 text-[11px] font-black uppercase tracking-widest text-slate-500">取消</button>
              <button onClick={logic.saveEdit} className={`flex-1 py-3 rounded-xl ${themeBg} text-white shadow-lg text-[11px] font-black uppercase tracking-widest hover:brightness-110`}>保存更改</button>
            </div>
          </div>
        </div>
      )}

      {detailDialog && (
        <div className="fixed inset-0 z-[420] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden">
            <div className={`px-6 py-4 ${themeBg} text-white flex items-center justify-between`}>
              <h3 className="text-sm font-black uppercase tracking-widest">设备详细信息</h3>
              <button onClick={() => setDetailDialog(null)} className="text-white/60 hover:text-white transition-colors">✕</button>
            </div>
            <div className="p-6 space-y-5">
              {detailDialog.detail ? (
                <div className="grid grid-cols-2 gap-4 text-[11px]">
                  <div className="space-y-1">
                    <div className="text-slate-400 font-bold uppercase">品牌</div>
                    <div className="font-black text-slate-900">{detailDialog.detail.品牌 || '—'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-slate-400 font-bold uppercase">型号</div>
                    <div className="font-black text-slate-900">{detailDialog.detail.型号 || '—'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-slate-400 font-bold uppercase">产品名称</div>
                    <div className="font-black text-slate-900">{detailDialog.detail.产品名称 || '—'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-slate-400 font-bold uppercase">市场价</div>
                    <div className="font-black text-slate-900">¥{Number(detailDialog.detail.市场价 || 0).toLocaleString()}</div>
                  </div>
                  {detailDialog.detail.描述 && (
                    <div className="col-span-2 space-y-1">
                      <div className="text-slate-400 font-bold uppercase">描述</div>
                      <div className="text-slate-600 font-medium">{detailDialog.detail.描述}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[12px] text-slate-400 font-bold">未找到该设备的数据库信息。</div>
              )}

              {detailDialog.table && detailOptions.length > 0 && (
                <div className="border-t border-slate-100 pt-4 space-y-3">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">替换设备</div>
                  <div className="flex items-center space-x-3">
                    <select
                      value={replacementId}
                      onChange={e => setReplacementId(e.target.value ? Number(e.target.value) : '')}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-bold outline-none"
                    >
                      <option value="">请选择替换设备</option>
                      {detailOptions.map(opt => (
                        <option key={opt.id} value={opt.id}>{opt.品牌} / {opt.产品名称} / {opt.型号}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        const selected = detailOptions.find(opt => opt.id === Number(replacementId));
                        if (!selected) return;
                        logic.replacePlanItem(detailDialog.resIdx, detailDialog.itemIdx, selected);
                        setDetailDialog(prev => prev ? { ...prev, detail: selected, item: { ...prev.item, name: selected.产品名称 || prev.item.name, model: selected.型号 || prev.item.model, brand: selected.品牌 || prev.item.brand, unitPrice: Number(selected.市场价) || prev.item.unitPrice } } : prev);
                      }}
                      className="px-4 py-2 rounded-lg bg-slate-900 text-white text-[11px] font-black uppercase"
                    >
                      确认替换
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default App;
