export interface SimulationSpeakerLike {
  type?: string;
  name?: string;
  model?: string;
}

export const isSimulationSpeakerItem = (item: SimulationSpeakerLike = {}) => {
  const text = `${item.type || ''} ${item.name || ''} ${item.model || ''}`;
  if (!/音箱|扬声器|线阵列|吸顶|同轴/i.test(text)) return false;
  if (/功放|吊挂架|吊架|挂架|支架/i.test(text)) return false;
  return true;
};
