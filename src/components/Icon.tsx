import type { SVGProps } from 'react'
import {
  Radio, ListMusic, UsersRound, Search, Plus, Trash2, FileCode2, Bot, ScanLine,
  Smartphone, Check, Clock3, TriangleAlert, Wifi, Users, Monitor, Play, Square,
  ArrowUpRight, GripVertical, Save, Copy, ChevronRight, Zap, BookOpen, Camera,
  Ellipsis, Pencil, X, Download, Upload, Menu, Info, CircleX, Layers3,
} from 'lucide-react'

const icons = {
  error: CircleX, layers: Layers3, info: Info, live: Radio, list: ListMusic, users: UsersRound, search: Search, plus: Plus,
  trash: Trash2, file: FileCode2, robot: Bot, sensor: ScanLine, phone: Smartphone,
  check: Check, clock: Clock3, alert: TriangleAlert, wifi: Wifi, group: Users,
  device: Monitor, play: Play, stop: Square, external: ArrowUpRight, grip: GripVertical,
  menu: Menu, save: Save, copy: Copy, chevron: ChevronRight, bolt: Zap, book: BookOpen,
  camera: Camera, dots: Ellipsis, edit: Pencil, x: X, download: Download, upload: Upload,
}

export function Icon({ name, size = 20, ...props }: { name: keyof typeof icons; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  const Glyph = icons[name]
  return <Glyph size={size} strokeWidth={1.75} aria-hidden="true" {...props} />
}
