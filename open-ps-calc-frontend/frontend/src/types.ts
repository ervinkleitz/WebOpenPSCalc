export interface BaseStats {
  str: number;
  agi: number;
  vit: number;
  int: number;
  dex: number;
  luk: number;
}

export interface BuildData {
  name: string;
  job_name?: string;
  job_id: number;
  base_level: number;
  job_level: number;
  base_stats: BaseStats;
  bonus_stats: Record<string, number>;
  equipped: Record<string, number | null>;
  refine: Record<string, number>;
  target_mob_id: number | null;
  server: string;
  weapon_element?: string;
  active_buffs?: Record<string, unknown>;
  mastery_levels?: Record<string, number>;
  flags?: Record<string, unknown>;
  manual_adj?: Record<string, unknown>;
  support_buffs?: Record<string, unknown>;
  player_active_scs?: Record<string, unknown>;
  song_state?: Record<string, unknown>;
  consumable_buffs?: ConsumableBuffs;
}

export interface ConsumableBuffs {
  aspd_potion?: number;
  atk_item?: number;
  matk_item?: number;
}

export interface SkillState {
  id: number;
  level: number;
  label: string;
}

export interface CustomTarget {
  def_: number;
  mdef_: number;
  vit: number;
  level: number;
  size: string;
  race: string;
  element: number;
  element_level: number;
  is_boss: boolean;
  luk: number;
  agi: number;
  int_: number;
}

export interface PassiveSkill {
  name: string;
  mastery_key: string;
  description: string;
  max_level: number;
}

export interface EquippedItemInfo {
  id: number;
  name: string;
  slots?: number;
}

export interface SearchResult {
  id: number;
  label: string;
  sublabel: string;
}

export type TargetMode = "monster" | "custom";

export interface UrlEditorState {
  build: BuildData;
  skill: SkillState;
  targetMode: TargetMode;
  customTarget: CustomTarget;
}
