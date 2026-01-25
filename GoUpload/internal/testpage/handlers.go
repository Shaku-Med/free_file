package testpage

import (
	"os"
	"path/filepath"
	"sync"

	"github.com/gofiber/fiber/v2"
)

var (
	htmlOnce sync.Once
	htmlData []byte
	htmlErr  error
)

func RegisterRoutes(app *fiber.App) {
	app.Get("/__dev/upload-test", func(c *fiber.Ctx) error {
		body, err := loadHTML()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("dev page unavailable")
		}
		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.Send(body)
	})
}

func loadHTML() ([]byte, error) {
	htmlOnce.Do(func() {
		wd, err := os.Getwd()
		if err != nil {
			htmlErr = err
			return
		}
		path := filepath.Join(wd, "internal", "testpage", "pages", "upload.html")
		htmlData, htmlErr = os.ReadFile(path)
	})
	return htmlData, htmlErr
}
