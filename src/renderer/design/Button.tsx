import { ButtonHTMLAttributes } from 'react'
import './Button.css'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'quiet' | 'selected' | 'critical'
}

export function Button({ variant = 'primary', className, ...rest }: ButtonProps) {
  const classes = ['nx-button', `nx-button--${variant}`, className].filter(Boolean).join(' ')
  return <button className={classes} {...rest} />
}
