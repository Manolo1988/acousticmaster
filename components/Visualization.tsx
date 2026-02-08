
import React from 'react';
import { AcousticParams, Scenario, EquipmentItem } from '../types';

interface VisualizationProps {
  params: AcousticParams;
  scenario: Scenario;
  blueprint: string | null;
  items?: EquipmentItem[]; // 接收具体方案的设备清单以实现差异化显示
}

const Visualization: React.FC<VisualizationProps> = ({ params, scenario, blueprint, items = [] }) => {
  const scale = 22;
  const roomWidth = params.width * scale;
  const roomLength = params.length * scale;

  const stageWidthPx = (params.stageWidth || 0) * scale;
  const stageDepthPx = (params.stageDepth || 0) * scale;

  // 根据方案中的音箱数量计算布局
  const speakerItem = items.find(item => item.type === '音箱');
  const speakerCount = speakerItem ? speakerItem.quantity : 0;

  const renderSpeakers = () => {
    const speakers = [];
    if (speakerCount === 0) return null;

    // 简单的布局算法：根据数量分布在房间内
    if (speakerCount === 2) {
      speakers.push({ left: '20%', top: '50%' }, { left: '80%', top: '50%' });
    } else if (speakerCount === 4) {
      speakers.push(
        { left: '20%', top: '20%' }, { left: '80%', top: '20%' },
        { left: '20%', top: '80%' }, { left: '80%', top: '80%' }
      );
    } else if (speakerCount > 4) {
      for (let i = 0; i < speakerCount; i++) {
        speakers.push({ 
          left: `${15 + (i % 3) * 35}%`, 
          top: `${15 + Math.floor(i / 3) * 35}%` 
        });
      }
    } else {
      speakers.push({ left: '50%', top: '50%' });
    }

    return speakers.map((pos, i) => (
      <div 
        key={i} 
        className="absolute w-4 h-4 -ml-2 -mt-2 bg-blue-500 rounded-full border-2 border-white shadow-lg animate-pulse"
        style={{ left: pos.left, top: pos.top }}
      >
        <div className="absolute inset-0 bg-blue-400 rounded-full animate-ping opacity-20"></div>
      </div>
    ));
  };

  return (
    <div className="w-full h-full flex items-center justify-center p-8 bg-transparent relative overflow-auto scrollbar-hide">
      {blueprint && (
        <img 
          src={blueprint} 
          alt="图纸" 
          className="absolute inset-0 w-full h-full object-contain opacity-10 pointer-events-none grayscale" 
        />
      )}
      
      <div 
        className="relative border border-slate-800 shadow-2xl transition-all duration-500 bg-white rounded-sm"
        style={{ width: `${roomLength}px`, height: `${roomWidth}px` }}
      >
        {/* 尺寸标注 */}
        <div className="absolute -top-7 left-0 right-0 flex items-center justify-between px-1">
          <div className="h-px bg-slate-200 flex-1"></div>
          <div className="mx-2 text-[9px] font-mono font-bold text-slate-500 uppercase tracking-tighter whitespace-nowrap">
            L: {params.length}M
          </div>
          <div className="h-px bg-slate-200 flex-1"></div>
        </div>

        <div className="absolute -left-10 top-0 bottom-0 flex flex-col items-center justify-between py-1">
          <div className="w-px bg-slate-200 flex-1"></div>
          <div className="my-2 text-[9px] font-mono font-bold text-slate-500 uppercase -rotate-90 whitespace-nowrap">
            W: {params.width}M
          </div>
          <div className="w-px bg-slate-200 flex-1"></div>
        </div>

        {/* 渲染音箱点位 - 体现方案差异 */}
        {renderSpeakers()}

        {/* 舞台布局 */}
        {scenario === Scenario.LECTURE_HALL && stageWidthPx > 0 && stageDepthPx > 0 && (
          <div 
            className="absolute bg-slate-50 border border-slate-200 flex flex-col items-center justify-center overflow-hidden transition-all duration-300 rounded-sm"
            style={{ 
              bottom: 0, 
              left: '50%', 
              transform: 'translateX(-50%)',
              width: `${Math.min(stageWidthPx, roomLength)}px`, 
              height: `${Math.min(stageDepthPx, roomWidth)}px` 
            }}
          >
             <div className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter text-center px-1">STAGE</div>
          </div>
        )}

        <div className="absolute -top-[1px] -left-[1px] w-1.5 h-1.5 border-t border-l border-slate-900"></div>
        <div className="absolute -top-[1px] -right-[1px] w-1.5 h-1.5 border-t border-r border-slate-900"></div>
        <div className="absolute -bottom-[1px] -left-[1px] w-1.5 h-1.5 border-b border-l border-slate-900"></div>
        <div className="absolute -bottom-[1px] -right-[1px] w-1.5 h-1.5 border-b border-r border-slate-900"></div>
      </div>
    </div>
  );
};

export default Visualization;
