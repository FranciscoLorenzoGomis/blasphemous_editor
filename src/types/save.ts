import type { ReadableSaveJson } from "../utils/saveParser"
import type { ArsenalWeaponKey } from "../utils/arsenalWeapons"

export interface SaveContextType {
  save: ReadableSaveJson | null
  setSave: (save: ReadableSaveJson | null) => void
  openSaveFile: () => void
  saveFileName: string | null
  exportSaveWithUnlockedWeapons: (weaponKeys: ArsenalWeaponKey[]) => Promise<void>
  repairWeaponWheel: () => Promise<void>
}
