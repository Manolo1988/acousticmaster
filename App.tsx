
import React, { useRef, useEffect, useState } from 'react';
import { Scenario, Page, SolutionTab, ResultTab } from './types';
import { MIC_TYPES, SCENARIO_THEMES, VERIFY_THEME } from './constants';
import Visualization from './components/Visualization';
import { useAcousticLogic } from './hooks/useAcousticLogic';

type ResultView = 'TABLE' | 'WORD';

const App: React.FC = () => {
  const logic = useAcousticLogic();
  const [activeResultView, setActiveResultView] = useState<ResultView>('TABLE');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [editingEq, setEditingEq] = useState<any>(null);
  const [isAddingEq, setIsAddingEq] = useState(false);
  const [editingHistory, setEditingHistory] = useState<any>(null);
  
  // 新增：生成报告对话框状态
  const [showReportDialog, setShowReportDialog] = useState(false);
  // 新增：项目名称编辑状态
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);

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

  // --- 子组件渲染 ---

  const renderTopNav = () => (
    <header className="bg-white border-b h-11 px-5 flex items-center justify-between z-50 shrink-0 shadow-sm">
      <div className="flex items-center space-x-6">
        <div className="text-base font-black tracking-tighter uppercase text-slate-900">
          声学<span className={themeText}>大师</span>
        </div>
        <nav className="flex space-x-5 h-11">
          {(Object.values(Page) as Page[]).map(p => (
            <button key={p} onClick={() => logic.setCurrentPage(p)} 
              className={`text-[11px] font-bold h-full relative px-1 transition-all flex items-center ${logic.currentPage === p ? `${themeText} border-b-2 ${themeBorder}` : 'text-slate-400 hover:text-slate-900'}`}>
              {p === Page.SOLUTION ? '方案中心' : p === Page.MANAGEMENT ? '资源管理' : '历史设计'}
            </button>
          ))}
        </nav>
      </div>
      <button className="w-7 h-7 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 border transition-all">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
      </button>
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
                {/* 项目名称展示与编辑 */}
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
              <div className="flex bg-slate-100 p-0.5 rounded-md border border-slate-200">
                {[{id:ResultTab.PLAN, l:'方案明细'},{id:ResultTab.SIMULATION, l:'声学仿真'}].map(t => (
                  <button key={t.id} onClick={() => logic.setCurrentResultTab(t.id)} className={`px-3 py-1 rounded-sm text-[10px] font-bold transition-all ${logic.currentResultTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>{t.l}</button>
                ))}
              </div>
              
              {logic.currentResultTab === ResultTab.PLAN && (
                <div className="flex items-center space-x-2">
                   {activeResultView === 'TABLE' ? (
                     <button 
                       onClick={() => logic.handleDownload('EXCEL')}
                       className="flex items-center space-x-2 px-3 h-8 rounded-md font-bold text-[9px] uppercase border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
                     >
                       <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                       <span>导出清单 (Excel)</span>
                     </button>
                   ) : (
                     <button 
                       onClick={() => logic.handleDownload('WORD')}
                       className="flex items-center space-x-2 px-3 h-8 rounded-md font-bold text-[9px] uppercase border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
                     >
                       <svg className="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                       <span>导出方案 (Word)</span>
                     </button>
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
                </div>
              )}
              {logic.currentResultTab === ResultTab.SIMULATION && (
                <button 
                   onClick={() => logic.handleDownload('PNG')}
                   className="flex items-center space-x-2 px-4 h-8 rounded-md font-black text-[10px] uppercase border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm active:scale-95 transition-all"
                >
                   <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                   <span>下载仿真图 (PNG)</span>
                </button>
              )}
            </div>
          </div>

          {logic.currentResultTab === ResultTab.PLAN && (
            <div className="space-y-3 flex-1 flex flex-col">
              <div className="flex justify-between items-center shrink-0">
                <div className="flex space-x-1">
                  {logic.designState.results.map((res, idx) => (
                    <button key={res.id} onClick={() => { logic.setDesignState(prev => ({ ...prev, activeResultIndex: idx })); setActiveResultView('TABLE'); }}
                      className={`px-3 py-1.5 rounded-md text-[10px] font-black transition-all ${logic.designState.activeResultIndex === idx ? `bg-slate-900 text-white shadow-md` : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
                      {res.title}
                    </button>
                  ))}
                </div>
                <div className="bg-slate-50 p-0.5 rounded-md border border-slate-200 flex items-center h-8">
                   <button onClick={() => setActiveResultView('TABLE')} className={`px-3 h-7 rounded-sm text-[10px] font-bold transition-all ${activeResultView === 'TABLE' ? `bg-white ${themeText} shadow-sm` : 'text-slate-400'}`}>数据清单</button>
                   <button onClick={() => setActiveResultView('WORD')} className={`px-3 h-7 rounded-sm text-[10px] font-bold transition-all ${activeResultView === 'WORD' ? `bg-white ${themeText} shadow-sm` : 'text-slate-400'}`}>方案预览</button>
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
                        {logic.designState.results[logic.designState.activeResultIndex]?.items.map((item, idx) => (
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
                     <div className="max-w-2xl mx-auto bg-white shadow-xl border border-slate-100 rounded-lg p-10 space-y-6">
                        <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase border-b-2 border-slate-900 pb-2">声学系统设计方案</h1>
                        <p className={`text-[10px] border-l-4 ${themeBorder} pl-4 text-slate-500 leading-relaxed font-bold uppercase`}>基于建筑声学计算与电声仿真。文档包含详细的技术拓扑、声场压力图及分项设备清单。</p>
                        <div className="aspect-[1/1.41] bg-slate-50 border border-dashed border-slate-200 rounded flex flex-col items-center justify-center text-slate-300 font-black text-[12px] uppercase tracking-[0.5em] space-y-4">
                           <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-200">
                             <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                           </div>
                           <span>方案说明书预览</span>
                        </div>
                     </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {logic.currentResultTab === ResultTab.SIMULATION && (
            <div className="flex-1 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden relative shadow-inner min-h-[350px]">
               <Visualization params={logic.designState.params} scenario={logic.designState.scenario} blueprint={logic.designState.blueprint} />
            </div>
          )}
        </div>
      )}

      {/* 生成文档选择对话框 */}
      {showReportDialog && (
        <div className="fixed inset-0 z-[300] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-5">
           <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between border-b pb-3">
                 <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">生成报告范围</h3>
                 <button onClick={() => setShowReportDialog(false)} className="text-slate-300 hover:text-slate-900 transition-colors">✕</button>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">请选择您需要生成并下载文档的方案范围。系统将自动汇总配置并转换成正式 Word 文件。</p>
              <div className="grid grid-cols-1 gap-3">
                 <button 
                    onClick={() => { logic.handleGenerateReports('CURRENT'); setShowReportDialog(false); }}
                    className="flex flex-col items-start p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-blue-400 hover:shadow-md transition-all group"
                 >
                    <span className="text-[11px] font-black text-slate-900 group-hover:text-blue-600">仅当前方案</span>
                    <span className="text-[9px] text-slate-400 mt-1">仅对当前选中的 [{logic.designState.results[logic.designState.activeResultIndex]?.title}] 进行文档导出。</span>
                 </button>
                 <button 
                    onClick={() => { logic.handleGenerateReports('ALL'); setShowReportDialog(false); }}
                    className="flex flex-col items-start p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-blue-400 hover:shadow-md transition-all group"
                 >
                    <span className="text-[11px] font-black text-slate-900 group-hover:text-blue-600">全部推荐方案</span>
                    <span className="text-[9px] text-slate-400 mt-1">汇总并导出本次设计生成的所有 {logic.designState.results.length} 个备选方案。</span>
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );

  const renderVerificationView = () => (
    <div className="flex-1 flex overflow-hidden bg-white">
      <div className="w-[290px] bg-emerald-50/30 border-r border-slate-200 p-6 flex flex-col items-center shrink-0">
        <div className="w-full mb-6 text-center">
          <h2 className="text-xl font-black text-slate-900 mb-0.5 tracking-tight">核验工作站</h2>
          <p className="text-emerald-600 text-[8px] font-black tracking-[0.3em] uppercase underline decoration-emerald-200 underline-offset-4">Audit Workspace</p>
        </div>

        <div className="w-full space-y-3">
           <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center flex flex-col items-center justify-center space-y-1 cursor-pointer hover:border-emerald-400 transition-all bg-white group shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 group-hover:text-emerald-600 transition-colors">上传方案图纸</span>
           </div>
           <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center flex flex-col items-center justify-center space-y-1 cursor-pointer hover:border-emerald-400 transition-all bg-white group shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 group-hover:text-emerald-600 transition-colors">上传待审清单</span>
           </div>
           <button className="w-full py-2.5 bg-emerald-600 text-white rounded-lg font-bold text-[13px] shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all mt-4 uppercase tracking-widest">
              开始自动化审计
           </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center bg-white relative">
         <div className="flex flex-col items-center space-y-4 opacity-10">
            <svg className="w-24 h-24 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="0.5" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"></path></svg>
            <h3 className="text-xl font-black text-slate-900 tracking-[1em] uppercase ml-[1em]">实验室就绪中</h3>
         </div>
      </div>
    </div>
  );

  const renderManagementView = () => (
    <div className="flex-1 p-5 bg-slate-50 overflow-y-auto">
       <div className="flex items-center space-x-3 mb-5 sticky top-0 bg-slate-50/80 backdrop-blur pb-3 z-10">
          <div className="flex-1 relative">
             <input 
               type="text" 
               placeholder="通过型号、品牌或分类关键词搜索设备资源..." 
               value={logic.equipmentSearchQuery}
               onChange={e => logic.setEquipmentSearchQuery(e.target.value)}
               className="w-full bg-white border border-slate-200 rounded-lg px-5 py-2 text-[11px] font-bold outline-none focus:ring-1 focus:ring-blue-100 shadow-sm"
             />
             <svg className="w-3.5 h-3.5 absolute right-4 top-1/2 -translate-y-1/2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </div>
          <button 
            onClick={() => setIsAddingEq(true)}
            className="px-5 py-2 bg-slate-900 text-white rounded-lg font-bold shadow hover:bg-black transition-all text-[11px] uppercase tracking-widest"
          >
            + 新增资源库项
          </button>
       </div>

       <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
          {logic.equipments.map((eq, i) => (
            <div key={eq.id} className={`p-4 flex items-center justify-between group hover:bg-slate-50 transition-all ${i !== logic.equipments.length - 1 ? 'border-b border-slate-100' : ''}`}>
               <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-slate-50 rounded flex items-center justify-center font-black text-sm text-slate-300 group-hover:bg-slate-900 group-hover:text-white transition-all uppercase">{eq.category[0]}</div>
                  <div>
                    <h4 className="text-[12px] font-black text-slate-800 tracking-tight">{eq.brand} · {eq.model}</h4>
                    <p className="text-[10px] text-slate-400 font-medium truncate max-w-[400px] mt-0.5">{eq.specs}</p>
                  </div>
               </div>
               <div className="flex items-center space-x-3">
                  <button onClick={() => setEditingEq(eq)} className="text-[10px] px-3 py-1.5 rounded bg-slate-50 text-slate-600 font-bold hover:bg-slate-900 hover:text-white transition-all border border-transparent">编辑</button>
                  <button onClick={() => logic.deleteEquipment(eq.id)} className="text-[10px] px-3 py-1.5 rounded bg-slate-50 text-slate-600 font-bold hover:bg-red-600 hover:text-white transition-all border border-transparent">删除</button>
               </div>
            </div>
          ))}
          {logic.equipments.length === 0 && <div className="p-12 text-center text-slate-300 text-[11px] font-bold uppercase tracking-widest italic">没有找到符合条件的资源</div>}
       </div>

       {/* 设备详情模态框 */}
       {(editingEq || isAddingEq) && (
         <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-5">
            <div className="bg-white w-full max-w-sm rounded-xl p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
               <h3 className="text-base font-black text-slate-900 uppercase tracking-tight border-b pb-2">{isAddingEq ? '录入新资源' : '修改资源档案'}</h3>
               <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                     <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-300 ml-1 block uppercase">品牌名</label>
                        <input id="eq-brand" defaultValue={isAddingEq ? "" : editingEq.brand} className="w-full p-2.5 bg-slate-50 rounded border border-slate-100 text-[11px] outline-none font-bold focus:bg-white" />
                     </div>
                     <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-300 ml-1 block uppercase">型号名称</label>
                        <input id="eq-model" defaultValue={isAddingEq ? "" : editingEq.model} className="w-full p-2.5 bg-slate-50 rounded border border-slate-100 text-[11px] outline-none font-bold focus:bg-white" />
                     </div>
                  </div>
                  <div className="space-y-1">
                     <label className="text-[9px] font-black text-slate-300 ml-1 block uppercase">技术规范参数</label>
                     <textarea id="eq-specs" defaultValue={isAddingEq ? "" : editingEq.specs} className="w-full p-2.5 bg-slate-50 rounded border border-slate-100 text-[11px] outline-none font-medium min-h-[90px] resize-none focus:bg-white" />
                  </div>
               </div>
               <div className="flex space-x-2 pt-2">
                  <button onClick={() => { setEditingEq(null); setIsAddingEq(false); }} className="flex-1 py-2.5 bg-slate-100 rounded-lg font-bold text-slate-400 text-[10px] uppercase transition-colors hover:bg-slate-200">取消</button>
                  <button onClick={() => {
                    const b = (document.getElementById('eq-brand') as HTMLInputElement).value;
                    const m = (document.getElementById('eq-model') as HTMLInputElement).value;
                    const s = (document.getElementById('eq-specs') as HTMLTextAreaElement).value;
                    if (isAddingEq) logic.addEquipment({ id: Date.now().toString(), category: '音箱', brand: b, model: m, specs: s });
                    else logic.updateEquipment({ ...editingEq, brand: b, model: m, specs: s });
                    setEditingEq(null); setIsAddingEq(false);
                  }} className="flex-1 py-2.5 bg-slate-900 text-white rounded-lg font-bold text-[10px] uppercase shadow-lg hover:brightness-125 transition-all">确认录入</button>
               </div>
            </div>
         </div>
       )}
    </div>
  );

  const renderHistoryView = () => (
    <div className="flex-1 p-5 bg-slate-50 overflow-y-auto">
       <div className="flex items-baseline justify-between mb-5">
          <div className="flex items-baseline space-x-3">
            <h2 className="text-xl font-black text-slate-900 tracking-tight underline decoration-2 underline-offset-4">历史设计档案</h2>
            <span className="text-slate-300 text-[9px] font-bold uppercase tracking-widest">Design Archive</span>
          </div>
       </div>
       <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
          {logic.history.map((h, i) => (
            <div key={h.id} className={`p-4 flex items-center justify-between hover:bg-slate-50 transition-all group ${i !== logic.history.length - 1 ? 'border-b border-slate-100' : ''}`}>
               <div className="flex items-center space-x-4">
                  <div className={`w-2 h-2 rounded-full ${h.status === '已完成' ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.3)]' : 'bg-amber-500 shadow-[0_0_5px_rgba(245,158,11,0.3)]'}`}></div>
                  <div>
                    <h4 className="text-[12px] font-black text-slate-800 leading-tight group-hover:text-blue-600 transition-colors">{h.name}</h4>
                    <p className="text-[9px] text-slate-400 mt-0.5 uppercase font-bold tracking-wider">{h.date} · {h.type}</p>
                  </div>
               </div>
               <div className="flex items-center space-x-4">
                  <span className={`text-[9px] font-black uppercase tracking-widest ${h.status === '已完成' ? 'text-emerald-500/50' : 'text-amber-500/50'}`}>{h.status}</span>
                  <div className="flex space-x-2">
                     <button 
                        onClick={() => logic.setPreviewHistoryItem(h)}
                        title="预览历史方案"
                        className="p-2 rounded bg-slate-50 text-slate-400 hover:text-emerald-600 shadow-sm transition-all hover:bg-white border border-transparent hover:border-slate-100"
                     >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                     </button>
                     <button onClick={() => setEditingHistory(h)} className="p-2 rounded bg-slate-50 text-slate-400 hover:text-blue-600 shadow-sm transition-all hover:bg-white border border-transparent hover:border-slate-100">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                     </button>
                     <button onClick={() => logic.deleteHistory(h.id)} className="p-2 rounded bg-slate-50 text-slate-400 hover:text-red-600 shadow-sm transition-all hover:bg-white border border-transparent hover:border-slate-100">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                     </button>
                  </div>
               </div>
            </div>
          ))}
          {logic.history.length === 0 && <div className="p-12 text-center text-slate-300 text-[11px] font-bold uppercase tracking-widest italic">暂无历史设计归档</div>}
       </div>

       {editingHistory && (
         <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-5">
            <div className="bg-white w-full max-w-sm rounded-xl p-6 space-y-4 shadow-2xl animate-in zoom-in-95">
               <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest border-b pb-2">项目更名</h3>
               <div className="space-y-1">
                 <label className="text-[9px] font-black text-slate-300 ml-1 block uppercase">项目新名称</label>
                 <input 
                   value={editingHistory.name} 
                   onChange={e => setEditingHistory({...editingHistory, name: e.target.value})} 
                   className="w-full p-2.5 bg-slate-50 rounded border border-slate-200 outline-none font-bold text-[12px] focus:ring-1 focus:ring-blue-100" 
                 />
               </div>
               <div className="flex space-x-2 pt-2">
                  <button onClick={() => setEditingHistory(null)} className="flex-1 py-2.5 bg-slate-100 rounded font-bold text-[10px] text-slate-400 uppercase tracking-widest transition-colors hover:bg-slate-200">取消</button>
                  <button onClick={() => { logic.updateHistory(editingHistory); setEditingHistory(null); }} className="flex-1 py-2.5 bg-slate-900 text-white rounded font-bold text-[10px] uppercase tracking-widest shadow-md hover:brightness-125 transition-all">确认重命名</button>
               </div>
            </div>
         </div>
       )}
    </div>
  );

  // --- 历史预览详情子页面 (Overlay) ---
  const renderHistoryPreview = () => {
    if (!logic.previewHistoryItem) return null;
    const h = logic.previewHistoryItem;
    return (
      <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-md flex flex-col p-5 sm:p-10 animate-in fade-in zoom-in-95 duration-300">
        <div className="bg-white w-full h-full max-w-6xl mx-auto rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <header className="px-6 py-4 border-b bg-slate-50 flex items-center justify-between shrink-0">
             <div className="flex items-center space-x-3">
                <div className="bg-slate-900 text-white p-2 rounded-lg">
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </div>
                <div>
                   <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">{h.name}</h2>
                   <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{h.date} · 历史方案归档预览</p>
                </div>
             </div>
             <button onClick={logic.closeHistoryPreview} className="w-10 h-10 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-400 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
             </button>
          </header>
          
          <div className="flex-1 flex overflow-hidden">
            <aside className="w-72 border-r bg-slate-50/50 p-6 overflow-y-auto space-y-6 shrink-0">
               <section>
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 pb-1 border-b">场景参数</h3>
                  <div className="space-y-3">
                     <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-500">空间类型</span>
                        <span className="text-[10px] font-black text-slate-900">{h.scenario === Scenario.MEETING_ROOM ? '会议室' : '报告厅'}</span>
                     </div>
                     <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-500">尺寸 (L×W)</span>
                        <span className="text-[10px] font-black text-slate-900">{h.params.length}m × {h.params.width}m</span>
                     </div>
                     <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-500">安装高度</span>
                        <span className="text-[10px] font-black text-slate-900">{h.params.height}m</span>
                     </div>
                  </div>
               </section>
               <section>
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 pb-1 border-b">话筒配置</h3>
                  <div className="space-y-2">
                     {h.params.mics.map(m => (
                        <div key={m.id} className="flex justify-between items-center bg-white p-2 rounded border border-slate-100 shadow-sm">
                           <span className="text-[10px] font-bold text-slate-700">{m.type}</span>
                           <span className="text-[10px] font-black text-blue-600">×{m.count}</span>
                        </div>
                     ))}
                  </div>
               </section>
               {h.params.extraRequirements && (
                  <section>
                     <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 pb-1 border-b">其他说明</h3>
                     <p className="text-[10px] text-slate-600 font-medium leading-relaxed italic">"{h.params.extraRequirements}"</p>
                  </section>
               )}
            </aside>
            
            <main className="flex-1 flex flex-col overflow-hidden bg-white">
               <div className="p-6 border-b flex items-center justify-between shrink-0">
                  <div className="flex space-x-1">
                     {h.results.map((res, idx) => (
                        <div key={res.id} className="px-4 py-2 bg-slate-900 text-white rounded-md text-[11px] font-black shadow-lg">
                           {res.title}
                        </div>
                     ))}
                  </div>
                  <div className="flex space-x-2">
                     <button onClick={() => logic.handleDownload('EXCEL')} className="px-3 h-8 rounded border border-slate-200 text-[10px] font-bold text-slate-600 hover:bg-slate-50 transition-all flex items-center space-x-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                        <span>导出清单</span>
                     </button>
                     <button onClick={() => logic.handleDownload('WORD')} className="px-3 h-8 rounded border border-slate-200 text-[10px] font-bold text-slate-600 hover:bg-slate-50 transition-all flex items-center space-x-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                        <span>导出方案</span>
                     </button>
                  </div>
               </div>
               
               <div className="flex-1 overflow-y-auto p-6 space-y-8">
                  <section className="bg-slate-50/50 rounded-xl border border-slate-100 p-6 shadow-inner">
                     <h4 className="text-[12px] font-black text-slate-900 uppercase tracking-tighter mb-4 border-l-4 border-slate-900 pl-3">设备清单详情</h4>
                     <table className="w-full text-left text-[11px]">
                        <thead>
                           <tr className="text-slate-400 uppercase font-black tracking-widest text-[9px]">
                              <th className="pb-3 px-2">类型</th>
                              <th className="pb-3 px-2">设备名称</th>
                              <th className="pb-3 px-2 text-center">数量</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                           {h.results[0]?.items.map(item => (
                              <tr key={item.id}>
                                 <td className="py-2.5 px-2 text-slate-500">{item.type}</td>
                                 <td className="py-2.5 px-2 font-bold text-slate-900">{item.name} <span className="text-[9px] font-mono font-normal opacity-50 ml-1">{item.model}</span></td>
                                 <td className="py-2.5 px-2 text-center font-black text-slate-900">×{item.quantity}</td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                  </section>
                  
                  <section>
                     <h4 className="text-[12px] font-black text-slate-900 uppercase tracking-tighter mb-4 border-l-4 border-slate-900 pl-3">声学仿真预测</h4>
                     <div className="aspect-video bg-slate-50 rounded-xl border border-dashed border-slate-200 flex items-center justify-center overflow-hidden">
                        <Visualization params={h.params} scenario={h.scenario} blueprint={null} />
                     </div>
                  </section>
               </div>
            </main>
          </div>
        </div>
      </div>
    );
  };

  // --- 主渲染逻辑 ---

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white relative">
      {renderTopNav()}

      {logic.currentPage === Page.SOLUTION && (
        <div className="bg-white border-b h-9 flex items-center px-5 shrink-0 shadow-sm relative z-40">
          <div className="flex space-x-5 h-full">
            {[{id: SolutionTab.DESIGN, l: '方案设计'}, {id: SolutionTab.VERIFICATION, l: '方案验证'}].map(tab => (
              <button key={tab.id} onClick={() => logic.setCurrentSolutionTab(tab.id)} 
                className={`text-[11px] font-bold h-full relative flex items-center transition-all px-1 ${logic.currentSolutionTab === tab.id ? `${themeText} border-b-2 ${themeBorder}` : 'text-slate-300 hover:text-slate-500'}`}>
                {tab.l}
              </button>
            ))}
          </div>
        </div>
      )}

      <main className="flex-1 flex overflow-hidden">
        {logic.currentPage === Page.SOLUTION ? (
          <div className="flex-1 flex overflow-hidden">
            {logic.currentSolutionTab === SolutionTab.DESIGN && renderSolutionSidebar()}
            {logic.currentSolutionTab === SolutionTab.DESIGN ? renderSolutionView() : renderVerificationView()}
          </div>
        ) : logic.currentPage === Page.MANAGEMENT ? renderManagementView() : renderHistoryView()}
      </main>

      {/* 渲染子页面：历史预览 */}
      {renderHistoryPreview()}

      {/* AI 对话助手入口 */}
      <div className="fixed bottom-5 right-5 z-[60] flex flex-col items-end space-y-2.5">
        {!logic.isChatOpen && (
           <div className="bg-white px-3 py-1.5 rounded-lg shadow-2xl border border-slate-100 animate-in fade-in slide-in-from-bottom-2 duration-300">
             <p className="text-[10px] font-black text-slate-700 uppercase tracking-tight">需要声学辅助? ✨</p>
           </div>
        )}
        <button onClick={() => logic.setIsChatOpen(!logic.isChatOpen)} className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-2xl transition-all duration-300 transform hover:scale-110 active:scale-95 ${logic.isChatOpen ? 'bg-slate-900 text-white rotate-90' : `${themeBg} text-white`}`}>
          {logic.isChatOpen ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg> : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>}
        </button>
      </div>

      {/* AI 对话抽屉栏 */}
      <div className={`fixed inset-y-0 right-0 w-[340px] bg-white border-l border-slate-100 shadow-2xl z-[70] transition-all duration-300 transform ${logic.isChatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col h-full bg-slate-50/10">
          <header className="px-5 py-3 border-b bg-white flex items-center justify-between shadow-sm shrink-0">
            <div className="flex items-center space-x-2">
              <div className={`w-7 h-7 rounded bg-slate-900 flex items-center justify-center text-white text-base`}>✨</div>
              <div><h3 className="text-[12px] font-black text-slate-900 uppercase">声学助手</h3><p className="text-[8px] font-bold text-slate-300 uppercase tracking-widest leading-none">AI Assistant</p></div>
            </div>
            <button onClick={() => logic.setIsChatOpen(false)} className="text-slate-300 hover:text-slate-900 text-lg transition-colors">✕</button>
          </header>
          <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-hide">
            {logic.designState.chatHistory.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-1`}>
                <div className={`max-w-[95%] p-3.5 rounded-xl text-[11px] leading-relaxed shadow-sm ${msg.role === 'ai' ? 'bg-white border border-slate-100 text-slate-600' : `${themeBg} text-white font-medium`}`}>{msg.text}</div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="p-4 border-t bg-white shrink-0 shadow-[0_-2px_10px_rgba(0,0,0,0.02)]">
             <div className="relative">
                <textarea 
                  value={logic.chatInputValue} 
                  onChange={e => logic.setChatInputValue(e.target.value)} 
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); logic.handleSendMessage(); }}} 
                  className="w-full bg-slate-50 border border-slate-100 rounded-lg p-3 pr-10 text-[11px] outline-none min-h-[80px] resize-none focus:bg-white focus:ring-1 focus:ring-slate-200 transition-all shadow-inner font-medium" 
                  placeholder="请输入您的设计偏好或修改意见..." 
                />
                <button onClick={logic.handleSendMessage} disabled={!logic.chatInputValue.trim() || logic.isProcessingAi} className={`absolute right-1.5 bottom-1.5 w-7 h-7 rounded bg-slate-900 text-white flex items-center justify-center transition-all shadow-md ${!logic.chatInputValue.trim() || logic.isProcessingAi ? 'opacity-20 cursor-not-allowed' : 'hover:scale-105 active:scale-95 hover:brightness-125'}`}>
                   {logic.isProcessingAi ? '...' : '→'}
                </button>
             </div>
          </div>
        </div>
      </div>

      {/* 设备配置调整模态框 */}
      {logic.editingItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-5 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white w-full max-w-xs rounded-xl p-6 space-y-5 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight border-b pb-2">调整清单项配置</h3>
            <div className="space-y-3">
              <div className="space-y-1">
                 <label className="text-[9px] font-black text-slate-300 ml-1 block uppercase tracking-widest">产品规格名</label>
                 <input value={logic.editingItem.item.name} onChange={e => logic.setEditingItem({...logic.editingItem!, item: {...logic.editingItem!.item, name: e.target.value}})} className="w-full bg-slate-50 border border-slate-100 rounded px-3 py-2 text-[12px] font-bold outline-none focus:bg-white" />
              </div>
              <div className="flex items-center space-x-1.5 bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                 <button onClick={() => logic.setEditingItem({...logic.editingItem!, item: {...logic.editingItem!.item, quantity: Math.max(1, logic.editingItem!.item.quantity-1)}})} className="w-8 h-8 bg-white rounded border border-slate-200 text-slate-400 font-black shadow-sm transition-all hover:text-red-500">-</button>
                 <input readOnly value={logic.editingItem.item.quantity} className={`flex-1 text-center font-black text-base ${themeText} bg-transparent`} />
                 <button onClick={() => logic.setEditingItem({...logic.editingItem!, item: {...logic.editingItem!.item, quantity: logic.editingItem!.item.quantity+1}})} className="w-8 h-8 bg-white rounded border border-slate-200 text-slate-400 font-black shadow-sm transition-all hover:text-blue-600">+</button>
              </div>
            </div>
            <div className="flex space-x-2 pt-2">
              <button onClick={() => logic.setEditingItem(null)} className="flex-1 py-2.5 bg-slate-100 rounded font-bold text-[10px] text-slate-400 uppercase tracking-widest transition-colors hover:bg-slate-200">取消</button>
              <button onClick={logic.saveEdit} className={`flex-1 py-2.5 ${themeBg} text-white rounded font-bold text-[10px] uppercase tracking-widest shadow-lg hover:brightness-110 transition-all`}>保存更改</button>
            </div>
          </div>
        </div>
      )}

      {/* 生成文档选择对话框 */}
      {showReportDialog && (
        <div className="fixed inset-0 z-[300] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-5">
           <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between border-b pb-3">
                 <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">生成报告范围</h3>
                 <button onClick={() => setShowReportDialog(false)} className="text-slate-300 hover:text-slate-900 transition-colors">✕</button>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">请选择您需要生成并下载文档的方案范围。系统将自动汇总配置并转换成正式 Word 文件。</p>
              <div className="grid grid-cols-1 gap-3">
                 <button 
                    onClick={() => { logic.handleGenerateReports('CURRENT'); setShowReportDialog(false); }}
                    className="flex flex-col items-start p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-blue-400 hover:shadow-md transition-all group"
                 >
                    <span className="text-[11px] font-black text-slate-900 group-hover:text-blue-600">仅当前方案</span>
                    <span className="text-[9px] text-slate-400 mt-1">仅对当前选中的 [{logic.designState.results[logic.designState.activeResultIndex]?.title}] 进行文档导出。</span>
                 </button>
                 <button 
                    onClick={() => { logic.handleGenerateReports('ALL'); setShowReportDialog(false); }}
                    className="flex flex-col items-start p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-blue-400 hover:shadow-md transition-all group"
                 >
                    <span className="text-[11px] font-black text-slate-900 group-hover:text-blue-600">全部推荐方案</span>
                    <span className="text-[9px] text-slate-400 mt-1">汇总并导出本次设计生成的所有 {logic.designState.results.length} 个备选方案。</span>
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
