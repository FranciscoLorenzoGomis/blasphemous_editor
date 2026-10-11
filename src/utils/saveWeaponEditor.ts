import { ARSENAL_WEAPONS, type ArsenalWeaponKey } from "./arsenalWeapons"
import { B2BinaryReader } from "./binaryReader"
import { formatElementKey } from "./catalogs"

const SLOT_SAVE_MAGIC = [
  0xb3, 0xc3, 0xd3, 0xdb, 0x07, 0xf9, 0xf6, 0x9d,
] as const

interface NestedObjectLayout {
  typeIdRaw: number
  relA: bigint
  gap: Uint8Array
  payload: Uint8Array
}

interface CommonElementLayout {
  key: number
  object: NestedObjectLayout
}

interface RoomElementLayout {
  key: number
  object: NestedObjectLayout
}

interface RoomLayout {
  key: number
  elements: RoomElementLayout[]
}

class ByteWriter {
  private readonly chunks: Uint8Array[] = []

  writeInt32(value: number): void {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setInt32(0, value, true)
    this.chunks.push(bytes)
  }

  writeUInt32(value: number): void {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, value, true)
    this.chunks.push(bytes)
  }

  writeInt64(value: bigint): void {
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setBigInt64(0, value, true)
    this.chunks.push(bytes)
  }

  writeBytes(value: Uint8Array): void {
    this.chunks.push(value)
  }

  toUint8Array(): Uint8Array {
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const chunk of this.chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }
}

function magicMatches(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < 12) return false
  for (let i = 0; i < magic.length; i++) {
    if (bytes[4 + i] !== magic[i]) return false
  }
  return true
}

function isSlotSave(bytes: Uint8Array): boolean {
  return magicMatches(bytes, SLOT_SAVE_MAGIC)
}

function readNestedObjectLayout(reader: B2BinaryReader): NestedObjectLayout {
  const typeIdRaw = reader.readUInt32()
  const relA = reader.readInt64()
  const relB = reader.readInt64()

  if (relA < 0n || relB < 0n) {
    throw new Error("Unsupported object layout: negative relative offsets")
  }

  const afterHeader = reader.position
  const payloadStart = afterHeader + Number(relA)
  const payloadEnd = payloadStart + Number(relB)

  if (payloadStart < afterHeader || payloadEnd > reader.bytes.length) {
    throw new Error("Invalid persistent object bounds")
  }

  const gap = reader.bytes.subarray(afterHeader, payloadStart).slice()
  reader.position = payloadStart
  const payload = reader.readBytes(Number(relB))
  reader.position = payloadEnd

  return { typeIdRaw, relA, gap, payload }
}

function writeNestedObjectLayout(writer: ByteWriter, object: NestedObjectLayout): void {
  writer.writeUInt32(object.typeIdRaw)
  writer.writeInt64(object.relA)
  writer.writeInt64(BigInt(object.payload.length))
  writer.writeBytes(object.gap)
  writer.writeBytes(object.payload)
}

interface EquipmentPayload {
  currentWeapon: number
  currentArmor: number
  weaponSlots: number[]
  unlockedWeapons: number[]
  trailing: Uint8Array
}

function decodeEquipmentPayload(payload: Uint8Array): EquipmentPayload {
  const reader = new B2BinaryReader(payload)
  if (reader.getRemaining() < 16) {
    throw new Error("Equipment payload too small")
  }

  const currentWeapon = reader.readInt32()
  const currentArmor = reader.readInt32()
  const slotCount = reader.readInt32()
  if (slotCount < 0 || slotCount > 16) {
    throw new Error("Unexpected weapon slot count")
  }

  const weaponSlots: number[] = []
  for (let i = 0; i < slotCount; i++) {
    if (reader.getRemaining() < 4) throw new Error("Malformed weapon slot list")
    weaponSlots.push(reader.readInt32())
  }

  if (reader.getRemaining() < 4) {
    throw new Error("Malformed unlocked weapons header")
  }

  const unlockedCount = reader.readInt32()
  if (unlockedCount < 0 || unlockedCount > 32) {
    throw new Error("Unexpected unlocked weapon count")
  }

  const unlockedWeapons: number[] = []
  for (let i = 0; i < unlockedCount; i++) {
    if (reader.getRemaining() < 4) {
      throw new Error("Malformed unlocked weapon list")
    }
    unlockedWeapons.push(reader.readInt32())
  }

  const trailing =
    reader.getRemaining() > 0 ? reader.readBytes(reader.getRemaining()) : new Uint8Array(0)

  return { currentWeapon, currentArmor, weaponSlots, unlockedWeapons, trailing }
}

function encodeEquipmentPayload(data: EquipmentPayload): Uint8Array {
  const writer = new ByteWriter()
  writer.writeInt32(data.currentWeapon)
  writer.writeInt32(data.currentArmor)
  writer.writeInt32(data.weaponSlots.length)
  for (const slot of data.weaponSlots) writer.writeInt32(slot)
  writer.writeInt32(data.unlockedWeapons.length)
  for (const weapon of data.unlockedWeapons) writer.writeInt32(weapon)
  if (data.trailing.length > 0) writer.writeBytes(data.trailing)
  return writer.toUint8Array()
}

function idHexToSignedInt32(idHex: string): number {
  const normalized = idHex.replace(/^0x/i, "")
  const unsigned = Number.parseInt(normalized, 16)
  if (!Number.isFinite(unsigned)) {
    throw new Error(`Invalid weapon id: ${idHex}`)
  }
  return unsigned > 0x7fffffff ? unsigned - 0x1_0000_0000 : unsigned
}

function weaponIdsFromKeys(keys: ArsenalWeaponKey[]): number[] {
  return keys.map((key) => idHexToSignedInt32(ARSENAL_WEAPONS[key].idHex))
}

function allKnownWeaponIds(): number[] {
  return weaponIdsFromKeys(Object.keys(ARSENAL_WEAPONS) as ArsenalWeaponKey[])
}

function mergeUnique(base: number[], toAdd: number[]): number[] {
  const out = [...base]
  const seen = new Set<number>(base)
  for (const value of toAdd) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function applyExactKnownWeaponSelection(
  existingUnlockedWeapons: number[],
  selectedIds: number[],
): number[] {
  const knownWeaponIds = new Set(allKnownWeaponIds())

  // Preserve any unknown values in case the game stores extra non-weapon flags here.
  const preservedUnknown = existingUnlockedWeapons.filter(
    (id) => !knownWeaponIds.has(id),
  )

  const selectedKnown = selectedIds.filter((id) => knownWeaponIds.has(id))
  return mergeUnique(preservedUnknown, selectedKnown)
}

function pickCurrentWeapon(
  currentWeapon: number,
  weaponSlots: number[],
  unlockedWeapons: number[],
): number {
  if (weaponSlots.includes(currentWeapon) || unlockedWeapons.includes(currentWeapon)) {
    return currentWeapon
  }

  if (weaponSlots.length > 0) return weaponSlots[0]
  if (unlockedWeapons.length > 0) return unlockedWeapons[0]
  return currentWeapon
}

function baseGameWeaponIds(): number[] {
  return weaponIdsFromKeys(["censer", "rapier", "sword"])
}

function buildSafeWheelSlots(
  currentSlots: number[],
  selectedIds: number[],
): number[] {
  const baseIds = baseGameWeaponIds()
  const baseSet = new Set(baseIds)

  const selectedBase = selectedIds.filter((id) => baseSet.has(id))
  const existingBase = currentSlots.filter((id) => baseSet.has(id))

  const merged = mergeUnique(existingBase, selectedBase)

  if (merged.length > 0) {
    return merged.slice(0, 3)
  }

  // Keep at least one valid slot if we cannot infer any base weapon from selection.
  if (currentSlots.length > 0) {
    return [currentSlots[0]]
  }

  return [baseIds[0]]
}

export function unlockWeaponsInSaveBytes(
  bytes: Uint8Array,
  weaponKeys: ArsenalWeaponKey[],
): Uint8Array {
  if (!isSlotSave(bytes)) {
    throw new Error("Only slot save files (.bin) can be edited")
  }

  const reader = new B2BinaryReader(bytes)
  const commonCount = reader.readInt32()

  const commonElements: CommonElementLayout[] = []
  let equipmentElementFound = false

  for (let i = 0; i < commonCount; i++) {
    const key = reader.readInt32()
    const object = readNestedObjectLayout(reader)

    if (formatElementKey(key, "manager") === "EQUIPMENT_MANAGER_ID") {
      const decoded = decodeEquipmentPayload(object.payload)
      const selectedIds = weaponIdsFromKeys(weaponKeys)
      const unlockedWeapons = applyExactKnownWeaponSelection(
        decoded.unlockedWeapons,
        selectedIds,
      )
      const weaponSlots = buildSafeWheelSlots(decoded.weaponSlots, selectedIds)
      const currentWeapon = pickCurrentWeapon(decoded.currentWeapon, weaponSlots, unlockedWeapons)

      object.payload = encodeEquipmentPayload({
        currentWeapon,
        currentArmor: decoded.currentArmor,
        weaponSlots,
        unlockedWeapons,
        trailing: decoded.trailing,
      })
      equipmentElementFound = true
    }

    commonElements.push({ key, object })
  }

  if (!equipmentElementFound) {
    throw new Error("Could not find EQUIPMENT_MANAGER_ID in this save")
  }

  const rooms: RoomLayout[] = []
  const roomCount = reader.readInt32()

  for (let r = 0; r < roomCount; r++) {
    const roomKey = reader.readInt32()
    const elementCount = reader.readInt32()
    const elements: RoomElementLayout[] = []

    for (let e = 0; e < elementCount; e++) {
      const elementKey = reader.readInt32()
      const object = readNestedObjectLayout(reader)
      elements.push({ key: elementKey, object })
    }

    rooms.push({ key: roomKey, elements })
  }

  if (reader.position !== reader.bytes.length) {
    throw new Error("Unexpected trailing bytes while rewriting save")
  }

  const writer = new ByteWriter()
  writer.writeInt32(commonCount)

  for (const element of commonElements) {
    writer.writeInt32(element.key)
    writeNestedObjectLayout(writer, element.object)
  }

  writer.writeInt32(roomCount)
  for (const room of rooms) {
    writer.writeInt32(room.key)
    writer.writeInt32(room.elements.length)
    for (const element of room.elements) {
      writer.writeInt32(element.key)
      writeNestedObjectLayout(writer, element.object)
    }
  }

  return writer.toUint8Array()
}

export function repairWeaponWheelInSaveBytes(bytes: Uint8Array): Uint8Array {
  if (!isSlotSave(bytes)) {
    throw new Error("Only slot save files (.bin) can be edited")
  }

  const reader = new B2BinaryReader(bytes)
  const commonCount = reader.readInt32()

  const commonElements: CommonElementLayout[] = []
  let equipmentElementFound = false

  const knownIds = allKnownWeaponIds()
  const knownIdSet = new Set(knownIds)
  const defaultIds = baseGameWeaponIds()

  for (let i = 0; i < commonCount; i++) {
    const key = reader.readInt32()
    const object = readNestedObjectLayout(reader)

    if (formatElementKey(key, "manager") === "EQUIPMENT_MANAGER_ID") {
      const decoded = decodeEquipmentPayload(object.payload)

      const unlockedKnown = decoded.unlockedWeapons.filter((id) => knownIdSet.has(id))
      const slotKnown = decoded.weaponSlots.filter((id) => knownIdSet.has(id) && defaultIds.includes(id))
      const basePool = mergeUnique(unlockedKnown, slotKnown)
      const pool = basePool.length > 0 ? basePool : [...defaultIds]

      const desiredSlotCount = 3
      const repairedSlots: number[] = []

      for (const id of pool) {
        if (repairedSlots.length >= desiredSlotCount) break
        repairedSlots.push(id)
      }

      for (const id of defaultIds) {
        if (repairedSlots.length >= desiredSlotCount) break
        if (!repairedSlots.includes(id)) repairedSlots.push(id)
      }

      while (repairedSlots.length < desiredSlotCount) {
        repairedSlots.push(repairedSlots[0] ?? defaultIds[0])
      }

      const repairedUnlocked = mergeUnique(decoded.unlockedWeapons, repairedSlots)
      const currentWeapon = repairedSlots[0]

      object.payload = encodeEquipmentPayload({
        currentWeapon,
        currentArmor: decoded.currentArmor,
        weaponSlots: repairedSlots,
        unlockedWeapons: repairedUnlocked,
        trailing: decoded.trailing,
      })

      equipmentElementFound = true
    }

    commonElements.push({ key, object })
  }

  if (!equipmentElementFound) {
    throw new Error("Could not find EQUIPMENT_MANAGER_ID in this save")
  }

  const rooms: RoomLayout[] = []
  const roomCount = reader.readInt32()

  for (let r = 0; r < roomCount; r++) {
    const roomKey = reader.readInt32()
    const elementCount = reader.readInt32()
    const elements: RoomElementLayout[] = []

    for (let e = 0; e < elementCount; e++) {
      const elementKey = reader.readInt32()
      const object = readNestedObjectLayout(reader)
      elements.push({ key: elementKey, object })
    }

    rooms.push({ key: roomKey, elements })
  }

  if (reader.position !== reader.bytes.length) {
    throw new Error("Unexpected trailing bytes while rewriting save")
  }

  const writer = new ByteWriter()
  writer.writeInt32(commonCount)

  for (const element of commonElements) {
    writer.writeInt32(element.key)
    writeNestedObjectLayout(writer, element.object)
  }

  writer.writeInt32(roomCount)
  for (const room of rooms) {
    writer.writeInt32(room.key)
    writer.writeInt32(room.elements.length)
    for (const element of room.elements) {
      writer.writeInt32(element.key)
      writeNestedObjectLayout(writer, element.object)
    }
  }

  return writer.toUint8Array()
}
