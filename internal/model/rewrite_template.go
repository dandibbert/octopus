package model

import "time"

// RewriteTemplate stores a reusable request-rewrite V2 configuration snapshot.
// Templates are copied into channel/group drafts when applied; they are not live links.
type RewriteTemplate struct {
	ID          int64     `json:"id" gorm:"primaryKey"`
	Name        string    `json:"name" gorm:"size:128;not null;uniqueIndex:idx_rewrite_template_scope_name"`
	Description string    `json:"description,omitempty" gorm:"size:512"`
	Scope       string    `json:"scope" gorm:"size:16;not null;uniqueIndex:idx_rewrite_template_scope_name"`
	Config      string    `json:"config" gorm:"type:text;not null"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
