
import { Scenario, AcousticParams } from './types';

export const DEFAULT_PARAMS: AcousticParams = {
  length: 20,
  width: 10,
  height: 8,
  stageToNearAudience: 0,
  stageToFarAudience: 0,
  stageWidth: 0,
  stageDepth: 0,
  hasCentralControl: true,
  hasMatrix: true,
  hasVideoConf: true,
  hasRecording: true,
  mics: [],
  micHandheld: 0,
  micGooseneck: 0,
  micOmni: 0,
  micLavalier: 0,
  micCeiling: 0,
  scenarioConfirmed: false,
  roomConfirmed: false,
  stageConfirmed: false,
  micsConfirmed: false,
  subsystemsConfirmed: false,
  extraRequirementsConfirmed: false,
  extraRequirements: ''
};

export const SCENARIO_THEMES = {
  [Scenario.MEETING_ROOM]: {
    color: 'blue-600',
    lightBg: 'bg-slate-50',
    chatBg: 'bg-blue-50/20'
  },
  [Scenario.LECTURE_HALL]: {
    color: 'purple-600',
    lightBg: 'bg-stone-50',
    chatBg: 'bg-purple-50/20'
  }
};

export const VERIFY_THEME = {
  color: 'emerald-600',
  lightBg: 'bg-emerald-50',
  chatBg: 'bg-emerald-50/30'
};

