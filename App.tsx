
import React, { useRef, useEffect, useState } from 'react';
import { Scenario, Page, SolutionTab, ResultTab, EquipmentCategory, Equipment, User } from './types';
import { MIC_TYPES, SCENARIO_THEMES, VERIFY_THEME } from './constants';
import Visualization from './components/Visualization';
import { useAcousticLogic } from './hooks/useAcousticLogic';

type ResultView = 'TABLE' | 'WORD';

const App: React.FC = () => {
  const logic = useAcousticLogic();
  const [activeResultView, setActiveResultView] = useState<ResultView>('TABLE');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [editingEq, setEditingEq] = useState<Equipment | null>(null);
  const [isAddingEq, setIsAddingEq] = useState(false);
  const [editingHistory, setEditingHistory] = useState<any>(null);
  
  // 用户管理弹窗状态
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isAddingUser, setIsAddingUser] = useState(false);

  // 用户个人资料下拉框状态
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const [showReportDialog, setShowReportDialog] = useState(false);
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);

  // 获取当前方案
  const activeResult = logic.designState.results[logic.designState.activeResultIndex];
  const hasGeneratedReport = !!activeResult?.wordLink;

  // 获取当前主题颜色配置
  const theme = logic.currentSolutionTab === SolutionTab.VERIFICATION 
    ? VERIFY_THEME 
    : SCENARIO_THEMES[logic.designState.scenario];

  const themeText = `text-${theme.color}`;
  const themeBg = `bg-${theme.color}`;
  const themeBorder = `border-${theme.color}`;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logic.designState.chatHistory, logic.isChatOpen]);

  // 当方案切换时，如果当前视图是方案预览且未生成，则切回到数据清单
  useEffect(() => {
    if (activeResultView === 'WORD' && !hasGeneratedReport) {
      setActiveResultView('TABLE');
    }
  }, [logic.designState.activeResultIndex, hasGeneratedReport]);

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
          {(Object.values(Page) as Page[]).map(p => (
            <button key={p} onClick={() => logic.setCurrentPage(p)} 
              className={`text-[11px] font-bold h-full relative px-1 transition-all flex items-center ${logic.currentPage === p ? `${themeText} border-b-2 ${themeBorder}` : 'text-slate-400 hover:text-slate-900'}`}>
              {p === Page.SOLUTION ? '方案中心' : p === Page.MANAGEMENT ? '资源管理' : p === Page.HISTORY ? '历史设计' : '用户管理'}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center space-x-4">
        {/* 用户头像与下拉菜单 */}
        <div className="relative" ref={profileRef}>
          <button 
            onClick={() => setIsProfileOpen(!isProfileOpen)}
            className={`flex items-center space-x-2 group p-0.5 pr-2 rounded-full border transition-all ${isProfileOpen ? 'bg-slate-50 border-slate-200' : 'border-transparent hover:bg-slate-50'}`}
          >
            <div className={`w-7 h-7 rounded-full ${themeBg} text-white flex items-center justify-center font-black text-[10px] shadow-sm relative`}>
              {logic.currentUser.name[0]}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white"></span>
            </div>
            <span className="text-[11px] font-bold text-slate-600 group-hover:text-slate-900">{logic.currentUser.name}</span>
            <svg className={`w-3 h-3 text-slate-300 transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"></path></svg>
          </button>

          {/* 下拉菜单 */}
          {isProfileOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200">
              {/* 用户信息头部 */}
              <div className="p-4 bg-slate-50/80 border-b border-slate-100">
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 rounded-full ${themeBg} text-white flex items-center justify-center font-black text-xs shadow-lg`}>
                    {logic.currentUser.name[0]}
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-900">{logic.currentUser.name}</div>
                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{logic.currentUser.role}</div>
                    <div className="text-[10px] text-slate-400 mt-1 truncate max-w-[140px]">{logic.currentUser.email}</div>
                  </div>
                </div>
              </div>

              {/* 菜单列表 */}
              <div className="p-2 space-y-1">
                <button className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all">
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
                <button 
                  onClick={() => { setIsProfileOpen(false); logic.handleLogout(); }}
                  className="w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-[11px] font-black text-red-500 hover:bg-red-50 transition-all uppercase tracking-widest"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                  <span>退出登录</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );

  const renderSolutionSidebar = () => (
    <div className={`w-[290px] ${theme.lightBg} border-r border-slate-200 overflow-y-auto p-3 flex flex-col space-y-3 scrollbar-hide shrink-0`}>
      <div className="bg-slate-200/40 p-0.5 rounded-lg flex border border-slate-200 shadow-inner">
        <button onClick={() => logic.handleParamChange('scenario', Scenario.MEETING_ROOM)} 
          className={`flex-1 py-1 rounded-md text-[11px] font-bold transition-all ${logic.designState.scenario === Scenario.MEETING_ROOM ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>
          会议室
        </button>
        <button onClick={() => logic.handleParamChange('scenario', Scenario.LECTURE_HALL)} 
          className={`flex-1 py-1 rounded-md text-[11px] font-bold transition-all ${logic.designState.scenario === Scenario.LECTURE_HALL ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500'}`}>
          报告厅
        </button>
      </div>
      
      <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 space-y-2">
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

      <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 space-y-2">
        <div className="flex items-center justify-between border-b pb-1">
          <h3 className={`text-[10px] font-black ${themeText} uppercase tracking-widest`}>话筒配置</h3>
          <button onClick={logic.addMic} className={`text-[8px] font-black px-1.5 py-0.5 rounded border ${themeText} ${themeBorder} bg-slate-50 hover:bg-white transition-colors`}>+ 添加</button>
        </div>
        <div className="space-y-1.5">
          {logic.designState.params.mics.map(m => (
            <div key={m.id} className="flex items-center space-x-1.5 group">
              <select value={m.type} onChange={e => logic.handleParamChange('mics', logic.designState.params.mics.map(mic => mic.id === m.id ? {...mic, type: e.target.value} : mic))} className="flex-1 bg-slate-50 border border-slate-100 rounded px-1.5 py-1 text-[11px] font-bold outline-none">
                {MIC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="number" value={m.count} onChange={e => logic.handleMicChange(m.id, parseInt(e.target.value))} className={`w-8 bg-white border border-slate-200 rounded py-1 text-center text-[11px] font-bold ${themeText} outline-none`} />
              <button onClick={() => logic.removeMic(m.id)} className="text-slate-300 hover:text-red-500 text-[9px] px-0.5">✕</button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 space-y-2">
        <h3 className="text-[10px] font-black text-slate-400 border-b pb-1 uppercase tracking-widest">配套子系统</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            {id:'hasCentralControl', l:'中控'}, {id:'hasMatrix', l:'矩阵'}, {id:'hasVideoConf', l:'视频'}, {id:'hasRecording', l:'录播'}
          ].map(sys => (
            <label key={sys.id} className="flex items-center space-x-1.5 bg-slate-50/50 p-1.5 rounded border border-slate-100 cursor-pointer hover:bg-white transition-all">
              <input type="checkbox" checked={(logic.designState.params as any)[sys.id]} onChange={e => logic.handleParamChange(sys.id as any, e.target.checked)} className={`w-3 h-3 rounded accent-${theme.color.split('-')[0]}`} />
              <span className="text-[10px] font-bold text-slate-600">{sys.l}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="bg-white p-3 rounded-lg shadow-sm border border-slate-100 space-y-1.5 flex-1">
        <h3 className="text-[10px] font-black text-slate-400 border-b pb-1 uppercase tracking-widest">其他需求</h3>
        <textarea 
          value={logic.designState.params.extraRequirements} 
          onChange={e => logic.handleParamChange('extraRequirements', e.target.value)} 
          placeholder="补充品牌偏好等..." 
          className="w-full bg-slate-50 border border-slate-100 rounded px-2 py-1.5 text-[11px] font-medium outline-none h-20 resize-none focus:bg-white transition-all"
        />
      </div>

      <button onClick={logic.startDesign} disabled={logic.isProcessingAi} className={`w-full py-2.5 ${themeBg} text-white rounded-lg font-bold text-[13px] shadow-lg hover:brightness-110 transition-all shrink-0 uppercase tracking-widest`}>
        {logic.isProcessingAi ? '生成中...' : '启动方案设计'}
      </button>
    </div>
  );

  const renderSolutionView = () => (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      {!logic.designState.isDesigned ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 opacity-10">
          <div className="text-7xl mb-6">📐</div>
          <h2 className="text-lg font-black uppercase tracking-[0.4em] text-center">输入参数开启智能设计方案</h2>
        </div>
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
                      onKeyDown={e => { if(e.key === 'Enter') setIsEditingProjectName(false); }}
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
                     {hasGeneratedReport && (
                       <div className="flex items-center space-x-2 animate-in fade-in slide-in-from-right-2 duration-300">
                          {activeResultView === 'TABLE' ? (
                            <button onClick={() => logic.handleDownload('EXCEL')} className="flex items-center space-x-2 px-3 h-8 rounded-md font-bold text-[9px] uppercase border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-all shadow-sm">
                              <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                              <span>导出清单 (Excel)</span>
                            </button>
                          ) : (
                            <button onClick={() => logic.handleDownload('WORD')} className="flex items-center space-x-2 px-3 h-8 rounded-md font-bold text-[9px] uppercase border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-all shadow-sm">
                              <svg className="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                              <span>导出方案 (Word)</span>
                            </button>
                          )}
                       </div>
                     )}
                     <button 
                       onClick={() => setShowReportDialog(true)} 
                       disabled={logic.isGeneratingDocs} 
                       className={`flex items-center space-x-2 px-4 h-8 rounded-md font-black text-[10px] uppercase transition-all shadow-md active:scale-95 ${logic.isGeneratingDocs ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : `${themeBg} text-white hover:brightness-110`}`}
                     >
                        {logic.isGeneratingDocs ? (
                          <>
                            <div className="w-3 h-3 border-2 border-slate-300 border-t-white rounded-full animate-spin"></div>
                            <span>生成中...</span>
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
              <div className="flex space-x-1">
                {logic.designState.results.map((res, idx) => (
                  <button key={res.id} onClick={() => { logic.setDesignState(prev => ({ ...prev, activeResultIndex: idx })); }}
                    className={`px-3 py-1.5 rounded-md text-[10px] font-black transition-all ${logic.designState.activeResultIndex === idx ? `bg-slate-900 text-white shadow-md` : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
                    {res.title}
                  </button>
                ))}
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
                      {hasGeneratedReport && (
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
                            <th className="px-5 py-2.5 font-bold text-slate-400 uppercase tracking-tighter">产品名称</th>
                            <th className="px-5 py-2.5 font-bold text-slate-400 uppercase tracking-tighter">型号规格</th>
                            <th className="px-5 py-2.5 font-bold text-slate-400 uppercase tracking-tighter text-center">数量</th>
                            <th className="px-5 py-2.5 text-right pr-5 font-bold text-slate-400 uppercase tracking-tighter">管理操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {activeResult?.items.map((item, idx) => (
                            <tr key={item.id} className="hover:bg-slate-50/50 transition-all group">
                              <td className="px-5 py-2.5 text-slate-500 font-medium">{item.type}</td>
                              <td className="px-5 py-2.5 font-bold text-slate-900">{item.name}</td>
                              <td className="px-5 py-2.5 text-slate-400 font-mono text-[10px]">{item.model}</td>
                              <td className={`px-5 py-2.5 font-black text-center ${themeText}`}>{item.quantity}</td>
                              <td className="px-5 py-2.5 text-right space-x-3 pr-5">
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
                       <div className="max-w-2xl mx-auto bg-white shadow-xl border border-slate-100 rounded-lg p-10 space-y-6 animate-in fade-in zoom-in-95 duration-300">
                          <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase border-b-2 border-slate-900 pb-2">声学系统设计方案 - {activeResult?.title}</h1>
                          <p className={`text-[10px] border-l-4 ${themeBorder} pl-4 text-slate-500 leading-relaxed font-bold uppercase`}>该方案文档已根据选定设备及仿真结果自动合成。您可以点击右上角按钮进行导出。</p>
                          <div className="aspect-[1/1.41] bg-slate-50 border border-dashed border-slate-200 rounded flex flex-col items-center justify-center text-slate-300 font-black text-[12px] uppercase tracking-[0.5em] space-y-4">
                             <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-200">
                               <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                             </div>
                             <span>正式说明书正文区</span>
                          </div>
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
    </div>
  );

  const renderManagementView = () => (
    <div className="flex-1 flex flex-col p-6 overflow-hidden bg-white">
      <div className="shrink-0 mb-6">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase">资源库管理</h2>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">精细化管理系统内置及用户自定义的声学设备资源</p>
      </div>

      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-6 flex flex-wrap items-end gap-4 shrink-0">
        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">设备类型过滤</label>
          <select 
            value={logic.equipmentTypeFilter}
            onChange={e => logic.setEquipmentTypeFilter(e.target.value as any)}
            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-[12px] font-bold outline-none focus:ring-2 focus:ring-blue-500/10 transition-all"
          >
            <option value="ALL">全部类型</option>
            <option value="音箱">音箱</option>
            <option value="功放">功放</option>
            <option value="话筒">话筒</option>
            <option value="矩阵">矩阵</option>
            <option value="中控">中控</option>
            <option value="视频会议">视频会议</option>
            <option value="录播">录播</option>
          </select>
        </div>
        <div className="space-y-1.5 flex-[2] min-w-[300px]">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">搜索名称/品牌/型号</label>
          <div className="relative">
            <input 
              type="text" 
              placeholder="输入关键词..." 
              value={logic.equipmentNameFilter}
              onChange={e => logic.setEquipmentNameFilter(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 pl-10 text-[12px] font-bold outline-none focus:ring-2 focus:ring-blue-500/10 transition-all"
            />
            <svg className="w-4 h-4 absolute left-3.5 top-2.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </div>
        </div>
        <button 
          onClick={() => setIsAddingEq(true)}
          className="bg-slate-900 text-white px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95"
        >
          + 录入新设备
        </button>
      </div>

      <div className="flex-1 bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col">
        <div className="flex-1 overflow-auto scrollbar-hide">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-slate-50 border-b z-10">
              <tr>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest w-32">设备类型</th>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">品牌 & 型号</th>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">技术规格说明</th>
                <th className="px-6 py-4 text-right pr-6 font-black text-slate-400 uppercase tracking-widest w-40">管理操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logic.equipments.map(eq => (
                <tr key={eq.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-tighter ${
                      eq.category === '音箱' ? 'bg-blue-50 text-blue-600 border border-blue-100' : 
                      eq.category === '话筒' ? 'bg-purple-50 text-purple-600 border border-purple-100' :
                      eq.category === '功放' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                      'bg-slate-50 text-slate-500 border border-slate-100'
                    }`}>{eq.category}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-black text-slate-900 text-[12px]">{eq.brand}</div>
                    <div className="font-bold text-slate-400 text-[10px] mt-0.5">{eq.model}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-slate-500 font-medium line-clamp-2 max-w-md">{eq.specs}</div>
                  </td>
                  <td className="px-6 py-4 text-right pr-6 space-x-3">
                    <button 
                      onClick={() => setEditingEq(eq)}
                      className="text-blue-600 font-black hover:underline uppercase tracking-widest text-[9px]"
                    >
                      修改
                    </button>
                    <button 
                      onClick={() => logic.deleteEquipment(eq.id)}
                      className="text-red-400 font-black hover:text-red-600 transition-colors uppercase tracking-widest text-[9px]"
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

      {(editingEq || isAddingEq) && (
        <div className="fixed inset-0 z-[500] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-5">
           <div className="bg-white w-full max-lg rounded-3xl shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between border-b pb-4">
                 <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                   {isAddingEq ? '录入新设备资源' : `编辑设备：${editingEq?.model}`}
                 </h3>
                 <button onClick={() => { setEditingEq(null); setIsAddingEq(false); }} className="text-slate-300 hover:text-slate-900 transition-colors">✕</button>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">设备类型</label>
                    <select id="modal-category" defaultValue={isAddingEq ? '音箱' : editingEq?.category} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none">
                      {['音箱', '功放', '话筒', '矩阵', '中控', '视频会议', '录播'].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                 </div>
                 <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">品牌名称</label>
                    <input id="modal-brand" defaultValue={isAddingEq ? "" : editingEq?.brand} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
                 </div>
                 <div className="col-span-2 space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">型号规格</label>
                    <input id="modal-model" defaultValue={isAddingEq ? "" : editingEq?.model} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" />
                 </div>
                 <div className="col-span-2 space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">技术指标描述</label>
                    <textarea id="modal-specs" defaultValue={isAddingEq ? "" : editingEq?.specs} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[12px] font-medium h-24 resize-none" />
                 </div>
              </div>

              <div className="flex space-x-3 pt-4">
                 <button onClick={() => { setEditingEq(null); setIsAddingEq(false); }} className="flex-1 py-3.5 rounded-2xl border border-slate-200 text-slate-400 font-black text-[11px] uppercase tracking-widest">取消操作</button>
                 <button onClick={() => {
                   const cat = (document.getElementById('modal-category') as HTMLSelectElement).value as EquipmentCategory;
                   const brand = (document.getElementById('modal-brand') as HTMLInputElement).value;
                   const model = (document.getElementById('modal-model') as HTMLInputElement).value;
                   const specs = (document.getElementById('modal-specs') as HTMLTextAreaElement).value;
                   if (isAddingEq) logic.addEquipment({ id: Date.now().toString(), category: cat, brand, model, specs });
                   else if (editingEq) logic.updateEquipment({ ...editingEq, category: cat, brand, model, specs });
                   setEditingEq(null); setIsAddingEq(false);
                 }} className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[11px] uppercase shadow-xl">确认保存</button>
              </div>
           </div>
        </div>
      )}
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
                <td className="px-6 py-4 font-black text-slate-900">{h.name}</td>
                <td className="px-6 py-4 text-slate-400 font-mono">{h.date}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                    h.scenario === Scenario.MEETING_ROOM ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
                  }`}>{h.scenario === Scenario.MEETING_ROOM ? '会议室' : '报告厅'}</span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center space-x-1.5">
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                    <span className="text-emerald-600 font-bold">{h.status}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-right pr-6 space-x-4">
                  <button onClick={() => logic.setPreviewHistoryItem(h)} className="text-blue-600 font-black hover:underline uppercase tracking-widest text-[9px]">详情预览</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderHistoryPreview = () => {
    const item = logic.previewHistoryItem!;
    return (
      <div className="flex-1 flex flex-col p-6 overflow-y-auto bg-white animate-in slide-in-from-right-4 duration-300">
        <div className="flex items-center space-x-4 mb-6">
          <button onClick={logic.closeHistoryPreview} className="w-10 h-10 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7"></path></svg>
          </button>
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase">{item.name}</h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">设计归档于 {item.date}</p>
          </div>
        </div>
        <button 
           onClick={() => {
             logic.setDesignState(prev => ({
               ...prev,
               projectName: `${item.name}_复件`,
               scenario: item.scenario,
               params: item.params,
               results: item.results,
               isDesigned: true
             }));
             logic.setCurrentPage(Page.SOLUTION);
             logic.setPreviewHistoryItem(null);
           }}
           className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[11px] uppercase tracking-widest mb-6"
        >
          重新载入此设计
        </button>
      </div>
    );
  };

  const renderUserManagementView = () => (
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
            <option value="系统管理员">系统管理员</option>
            <option value="资深工程师">资深工程师</option>
            <option value="设计助理">设计助理</option>
            <option value="访客">访客</option>
          </select>
        </div>
        <div className="space-y-1.5 flex-[2] min-w-[300px]">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">搜索姓名或邮箱</label>
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
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">姓名 & 邮箱</th>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">角色权限</th>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">最后活跃</th>
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest">状态</th>
                <th className="px-6 py-4 text-right pr-6 font-black text-slate-400 uppercase tracking-widest w-40">管理操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logic.users.map(u => (
                <tr key={u.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 rounded-full ${themeBg} text-white flex items-center justify-center font-black text-[10px]`}>{u.name[0]}</div>
                      <div>
                        <div className="font-black text-slate-900 text-[12px]">{u.name}</div>
                        <div className="font-bold text-slate-400 text-[10px]">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter border ${
                      u.role === '系统管理员' ? 'border-red-200 bg-red-50 text-red-600' :
                      u.role === '资深工程师' ? 'border-blue-200 bg-blue-50 text-blue-600' :
                      u.role === '设计助理' ? 'border-emerald-200 bg-emerald-50 text-emerald-600' :
                      'border-slate-200 bg-slate-50 text-slate-400'
                    }`}>{u.role}</span>
                  </td>
                  <td className="px-6 py-4 text-slate-400 font-mono text-[10px]">{u.lastActive}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${u.status === '活跃' ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.3)]' : 'bg-slate-300'}`}></div>
                      <span className={`text-[10px] font-bold ${u.status === '活跃' ? 'text-emerald-600' : 'text-slate-400'}`}>{u.status}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right pr-6 space-x-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setEditingUser(u)} className="text-blue-600 font-black hover:underline uppercase tracking-widest text-[9px]">编辑</button>
                    <button onClick={() => logic.deleteUser(u.id)} className="text-red-400 font-black hover:text-red-600 transition-colors uppercase tracking-widest text-[9px]">删除</button>
                  </td>
                </tr>
              ))}
              {logic.users.length === 0 && (
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
                   {isAddingUser ? '新增平台成员' : `编辑用户资料：${editingUser?.name}`}
                 </h3>
                 <button onClick={() => { setEditingUser(null); setIsAddingUser(false); }} className="text-slate-300 hover:text-slate-900 transition-colors">✕</button>
              </div>
              
              <div className="space-y-4">
                 <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">真实姓名</label>
                    <input id="user-name" defaultValue={isAddingUser ? "" : editingUser?.name} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="如：张三" />
                 </div>
                 <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">电子邮箱</label>
                    <input id="user-email" defaultValue={isAddingUser ? "" : editingUser?.email} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none" placeholder="如：zhangsan@acoustic.com" />
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">角色权限</label>
                      <select id="user-role" defaultValue={isAddingUser ? '设计助理' : editingUser?.role} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none">
                        <option value="系统管理员">系统管理员</option>
                        <option value="资深工程师">资深工程师</option>
                        <option value="设计助理">设计助理</option>
                        <option value="访客">访客</option>
                      </select>
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">账户状态</label>
                      <select id="user-status" defaultValue={isAddingUser ? '活跃' : editingUser?.status} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[12px] font-bold outline-none">
                        <option value="活跃">活跃 (Active)</option>
                        <option value="禁用">禁用 (Disabled)</option>
                      </select>
                   </div>
                 </div>
              </div>

              <div className="flex space-x-3 pt-4">
                 <button onClick={() => { setEditingUser(null); setIsAddingUser(false); }} className="flex-1 py-3.5 rounded-2xl border border-slate-200 text-slate-400 font-black text-[11px] uppercase tracking-widest hover:bg-slate-50 transition-all">取消</button>
                 <button onClick={() => {
                   const name = (document.getElementById('user-name') as HTMLInputElement).value;
                   const email = (document.getElementById('user-email') as HTMLInputElement).value;
                   const role = (document.getElementById('user-role') as HTMLSelectElement).value as any;
                   const status = (document.getElementById('user-status') as HTMLSelectElement).value as any;
                   
                   if (isAddingUser) logic.addUser({ id: Date.now().toString(), name, email, role, status, lastActive: '从未登录' });
                   else if (editingUser) logic.updateUser({ ...editingUser, name, email, role, status });
                   setEditingUser(null); setIsAddingUser(false);
                 }} className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-[11px] uppercase shadow-xl hover:bg-black transition-all">保存设置</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`flex flex-col h-screen ${theme.lightBg} overflow-hidden text-slate-900 font-sans`}>
      {renderTopNav()}
      <main className="flex-1 flex overflow-hidden">
        {logic.currentPage === Page.SOLUTION && (
          <>
            {renderSolutionSidebar()}
            {renderSolutionView()}
          </>
        )}
        {logic.currentPage === Page.MANAGEMENT && renderManagementView()}
        {logic.currentPage === Page.HISTORY && (logic.previewHistoryItem ? renderHistoryPreview() : renderHistoryView())}
        {logic.currentPage === Page.USERS && renderUserManagementView()}
      </main>

      {/* Chat AI Overlay */}
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
                  <div className={`max-w-[85%] p-3 rounded-2xl text-[12px] leading-relaxed shadow-sm ${
                    chat.role === 'user' ? `${themeBg} text-white rounded-tr-none` : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none'
                  }`}>
                    {chat.text}
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
    </div>
  );
};

export default App;
