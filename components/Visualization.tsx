
import React from 'react';
import { AcousticParams, Scenario } from '../types';

interface VisualizationProps {
  params: AcousticParams;
  scenario: Scenario;
  blueprint: string | null;
}

const Visualization: React.FC<VisualizationProps> = ({ params, scenario, blueprint }) => {
  const scale = 25;
  const roomWidth = params.width * scale;
  const roomLength = params.length * scale;

  // 计算舞台在画布中的实际像素尺寸 (如果是报告厅)
  const stageWidthPx = (params.stageWidth || 0) * scale;
  const stageDepthPx = (params.stageDepth || 0) * scale;

  return (
    <div className="w-full h-full flex items-center justify-center p-12 bg-transparent relative overflow-auto scrollbar-hide">
      {blueprint && (
        <img 
          src={blueprint} 
          alt="图纸" 
          className="absolute inset-0 w-full h-full object-contain opacity-20 pointer-events-none grayscale" 
        />
      )}
      
      <div 
        className="relative border-2 border-slate-900 shadow-lg transition-all duration-700 bg-white"
        style={{ width: `${roomLength}px`, height: `${roomWidth}px` }}
      >
        {/* 尺寸标注 */}
        <div className="absolute -top-10 left-0 right-0 flex items-center justify-between px-2">
          <div className="h-px bg-slate-300 flex-1"></div>
          <div className="mx-4 text-[10px] font-mono font-black text-slate-900 tracking-widest uppercase whitespace-nowrap">
            长度: {params.length}米
          </div>
          <div className="h-px bg-slate-300 flex-1"></div>
        </div>

        <div className="absolute -left-12 top-0 bottom-0 flex flex-col items-center justify-between py-2">
          <div className="w-px bg-slate-300 flex-1"></div>
          <div className="my-4 text-[10px] font-mono font-black text-slate-900 tracking-widest uppercase -rotate-90 whitespace-nowrap">
            宽度: {params.width}米
          </div>
          <div className="w-px bg-slate-300 flex-1"></div>
        </div>

        {/* 中心参考线 */}
        <div className="absolute inset-0 border border-slate-100 opacity-50 flex items-center justify-center pointer-events-none">
           <div className="w-px h-full bg-slate-100"></div>
           <div className="h-px w-full bg-slate-100 absolute"></div>
        </div>

        {/* 报告厅特定布局：动态绘制舞台 */}
        {scenario === Scenario.LECTURE_HALL && stageWidthPx > 0 && stageDepthPx > 0 && (
          <div 
            className="absolute bg-slate-100 border-b border-slate-300 flex flex-col items-center justify-center overflow-hidden transition-all duration-500"
            style={{ 
              bottom: 0, 
              left: '50%', 
              transform: 'translateX(-50%)',
              width: `${Math.min(stageWidthPx, roomLength)}px`, 
              height: `${Math.min(stageDepthPx, roomWidth)}px` 
            }}
          >
             <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center px-2">
               主席台 ({params.stageWidth}m x {params.stageDepth}m)
             </div>
             {/* 舞台装饰线条 */}
             <div className="absolute top-0 inset-x-0 h-1 bg-slate-200"></div>
          </div>
        )}

        {/* 护角标记 */}
        <div className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-slate-900"></div>
        <div className="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2 border-slate-900"></div>
        <div className="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2 border-slate-900"></div>
        <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-slate-900"></div>
      </div>
    </div>
  );
};

export default Visualization;
